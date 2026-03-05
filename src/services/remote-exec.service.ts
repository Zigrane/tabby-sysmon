import { Injectable } from '@angular/core'
import { take } from 'rxjs/operators'
import { TrackedSSHSession } from '../interfaces/ssh-session'

let ssh2Client: any = null
try {
    ssh2Client = require('ssh2').Client
} catch {
    // ssh2 not available — Plan C disabled
}

export type RemoteOS = 'linux' | 'windows' | 'unknown'

const DEFAULT_TIMEOUT_MS = 8000

function withTimeout<T> (promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
        promise.then(
            val => { clearTimeout(timer); resolve(val) },
            err => { clearTimeout(timer); reject(err) },
        )
    })
}

export function concatUint8Arrays (arrays: Uint8Array[]): Uint8Array {
    let totalLength = 0
    for (const arr of arrays) {
        totalLength += arr.length
    }
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const arr of arrays) {
        result.set(arr, offset)
        offset += arr.length
    }
    return result
}

type FallbackLevel = 'A' | 'B' | 'C'

@Injectable({ providedIn: 'root' })
export class RemoteExecService {
    private fallbackLevel = new Map<any, FallbackLevel>()
    private osCache = new Map<string, RemoteOS>()

    clearCacheForSession (session: TrackedSSHSession): void {
        if (session.sshClient) {
            this.fallbackLevel.delete(session.sshClient)
        }
        if (session.hostname) {
            this.osCache.delete(session.hostname)
        }
    }

    private execPlanByLevel: Record<FallbackLevel, (s: TrackedSSHSession, cmd: string, t: number) => Promise<string>> = {
        A: (s, cmd, t) => this.execPlanA(s, cmd, t),
        B: (s, cmd, t) => this.execPlanB(s, cmd, t),
        C: (s, cmd, t) => this.execPlanC(s, cmd, t),
    }

    private static readonly CASCADE_ORDER: FallbackLevel[] = ['A', 'B', 'C']

    async exec (session: TrackedSSHSession, command: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> {
        const cached = this.fallbackLevel.get(session.sshClient)

        // If we have a cached level, try it first
        if (cached) {
            try {
                return await this.execPlanByLevel[cached](session, command, timeoutMs)
            } catch (err) {
                console.warn(`[tabby-sysmon] Cached Plan ${cached} failed:`, err)
                this.fallbackLevel.delete(session.sshClient)
                // fall through to full cascade, skipping the level we already tried
            }
        }

        // Full cascade through all levels (skip already-tried cached level)
        const levels = RemoteExecService.CASCADE_ORDER.filter(l => l !== cached)
        for (const level of levels) {
            try {
                const result = await this.execPlanByLevel[level](session, command, timeoutMs)
                this.fallbackLevel.set(session.sshClient, level)
                return result
            } catch (err) {
                const logFn = level === 'C' ? console.error : console.warn
                logFn(`[tabby-sysmon] Plan ${level} failed:`, err)
            }
        }

        throw new Error('All exec strategies failed')
    }

    async detectOS (session: TrackedSSHSession): Promise<RemoteOS> {
        const cached = this.osCache.get(session.hostname)
        if (cached) return cached

        let os: RemoteOS = 'unknown'

        try {
            const uname = await this.exec(session, 'uname -s', DEFAULT_TIMEOUT_MS)
            const trimmed = uname.trim().toLowerCase()
            if (trimmed.includes('linux') || trimmed.includes('darwin') || trimmed.includes('freebsd')) {
                os = 'linux'
            }
        } catch {
            // uname failed, try Windows detection
        }

        if (os === 'unknown') {
            try {
                const echoOS = await this.exec(session, 'echo %OS%', DEFAULT_TIMEOUT_MS)
                const trimmed = echoOS.trim()
                if (trimmed.toLowerCase().includes('windows')) {
                    os = 'windows'
                }
            } catch {
                // echo %OS% failed
            }
        }

        if (os === 'unknown') {
            try {
                const psOS = await this.exec(session, 'powershell $env:OS', DEFAULT_TIMEOUT_MS)
                const trimmed = psOS.trim()
                if (trimmed.toLowerCase().includes('windows')) {
                    os = 'windows'
                }
            } catch {
                // powershell failed
            }
        }

        if (os !== 'unknown') {
            this.osCache.set(session.hostname, os)
        }
        return os
    }

    private async execPlanA (session: TrackedSSHSession, command: string, timeoutMs: number): Promise<string> {
        // openSessionChannel() returns NewChannel — must activate before use
        const channelTimeout = Math.min(timeoutMs, 5000)
        const newCh = await withTimeout(session.sshClient.openSessionChannel(), channelTimeout, 'openSessionChannel')
        const channel: any = await withTimeout(session.sshClient.activateChannel(newCh), channelTimeout, 'activateChannel')
        await withTimeout(channel.requestExec(command), channelTimeout, 'requestExec')

        const chunks: Uint8Array[] = []
        const dataTimeoutMs = Math.min(timeoutMs, 5000)

        return new Promise<string>((resolve, reject) => {
            let settled = false

            const cleanup = () => {
                clearTimeout(timeoutId)
                sub.unsubscribe()
                extSub.unsubscribe()
                closedSub?.unsubscribe()
                try { channel.close() } catch { /* ignore */ }
            }

            const timeoutId = setTimeout(() => {
                if (settled) return
                settled = true
                cleanup()
                reject(new Error(`Plan A timeout after ${dataTimeoutMs}ms`))
            }, dataTimeoutMs)

            const sub = channel.data$.subscribe({
                next: (chunk: Uint8Array) => chunks.push(chunk),
                error: (err: any) => {
                    if (settled) return
                    settled = true
                    cleanup()
                    reject(err)
                },
            })

            // extendedData$ emits [type, Uint8Array] tuples in russh
            const extSub = channel.extendedData$.subscribe({
                next: (ext: any) => {
                    const data = Array.isArray(ext) ? ext[1] : (ext.data ?? ext)
                    if (data instanceof Uint8Array) chunks.push(data)
                },
                error: () => { /* ignore extended data errors */ },
            })

            const resolveWithOutput = () => {
                if (settled) return
                settled = true
                cleanup()
                const combined = concatUint8Arrays(chunks)
                resolve(new TextDecoder().decode(combined))
            }

            // russh Channel has both eof$ and closed$ — use eof$ for command completion
            channel.eof$.pipe(take(1)).subscribe({
                next: () => resolveWithOutput(),
                error: (err: any) => {
                    if (settled) return
                    settled = true
                    cleanup()
                    reject(err)
                },
            })

            // Safety net: closed$ may fire without eof$ in some SSH implementations
            const closedSub = channel.closed$?.pipe(take(1)).subscribe(() => resolveWithOutput())
        })
    }

    private async execPlanB (session: TrackedSSHSession, command: string, timeoutMs: number): Promise<string> {
        const marker = `__SYSMON_END_${Date.now()}__`
        const channel: any = await withTimeout(session.sshSession.openShellChannel({ x11: false }), Math.min(timeoutMs, 5000), 'openShellChannel')

        return new Promise<string>((resolve, reject) => {
            let settled = false
            let output = ''
            const decoder = new TextDecoder()

            const timeoutId = setTimeout(() => {
                if (settled) return
                settled = true
                sub.unsubscribe()
                try { channel.close() } catch { /* ignore */ }
                reject(new Error(`Plan B timeout after ${timeoutMs}ms`))
            }, timeoutMs)

            const sub = channel.data$.subscribe({
                next: (chunk: Uint8Array) => {
                    if (settled) return
                    output += decoder.decode(chunk, { stream: true })
                    const markerIdx = output.indexOf(marker)
                    if (markerIdx !== -1) {
                        settled = true
                        clearTimeout(timeoutId)
                        sub.unsubscribe()
                        // Extract content before the marker, after the command echo
                        let result = output.substring(0, markerIdx)
                        // Remove the command echo lines (first occurrence of the command + marker echo)
                        const cmdLine = command + '\n'
                        const cmdIdx = result.indexOf(cmdLine)
                        if (cmdIdx !== -1) {
                            result = result.substring(cmdIdx + cmdLine.length)
                        }
                        try { channel.close() } catch { /* ignore */ }
                        resolve(result.trim())
                    }
                },
                error: (err: any) => {
                    if (settled) return
                    settled = true
                    clearTimeout(timeoutId)
                    reject(err)
                },
            })

            // Send command followed by marker echo
            channel.write(Buffer.from(`${command}\necho ${marker}\n`))
        })
    }

    private async execPlanC (session: TrackedSSHSession, command: string, timeoutMs: number): Promise<string> {
        if (!ssh2Client) {
            throw new Error('ssh2 module not available — Plan C disabled')
        }
        const Client = ssh2Client

        const opts = session.profile?.options ?? {}
        const host = opts.host ?? session.hostname
        const port = opts.port ?? 22
        const username = opts.user ?? 'root'

        const connectConfig: any = {
            host,
            port,
            username,
            readyTimeout: timeoutMs,
        }

        if (opts.privateKey) {
            connectConfig.privateKey = opts.privateKey
        } else if (opts.password) {
            connectConfig.password = opts.password
        }

        return new Promise<string>((resolve, reject) => {
            const conn = new Client()

            const timeoutId = setTimeout(() => {
                conn.end()
                reject(new Error(`Plan C timeout after ${timeoutMs}ms`))
            }, timeoutMs)

            conn.on('ready', () => {
                conn.exec(command, (err: any, stream: any) => {
                    if (err) {
                        clearTimeout(timeoutId)
                        conn.end()
                        reject(err)
                        return
                    }

                    const chunks: Buffer[] = []

                    stream.on('data', (data: Buffer) => {
                        chunks.push(data)
                    })

                    stream.stderr.on('data', (data: Buffer) => {
                        chunks.push(data)
                    })

                    stream.on('close', () => {
                        clearTimeout(timeoutId)
                        conn.end()
                        resolve(Buffer.concat(chunks).toString('utf8'))
                    })
                })
            })

            conn.on('error', (err: any) => {
                clearTimeout(timeoutId)
                reject(err)
            })

            conn.connect(connectConfig)
        })
    }
}
