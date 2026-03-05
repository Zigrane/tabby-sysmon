import { Injectable } from '@angular/core'
import { Observable, timer, of, from } from 'rxjs'
import { switchMap, catchError, map } from 'rxjs/operators'
import { SystemMetrics, emptyMetrics } from '../interfaces/metrics'
import { TrackedSSHSession } from '../interfaces/ssh-session'
import { RemoteExecService, RemoteOS } from './remote-exec.service'
import { getLinuxBatchCommand, parseLinuxBatchOutput } from '../utils/parse-linux-stats'
import { getWindowsBatchCommand, parseWindowsBatchOutput } from '../utils/parse-windows-stats'

@Injectable({ providedIn: 'root' })
export class RemoteMetricsService {
    private lastGoodMetrics = new Map<string, SystemMetrics>()

    constructor (private remoteExec: RemoteExecService) {}

    createMetricsStream (session: TrackedSSHSession, intervalMs: number, diskMount: string): Observable<SystemMetrics> {
        const displayHost = session.username ? `${session.username}@${session.hostname}` : session.hostname
        this.remoteExec.clearCacheForSession(session)
        return from(this.remoteExec.detectOS(session)).pipe(
            switchMap(os => {
                if (os === 'unknown') {
                    const metrics = emptyMetrics('remote', displayHost)
                    metrics.errors['os'] = 'Could not detect remote OS'
                    metrics.partial = true
                    return of(metrics)
                }

                // Fix mount point mismatch: local Windows config may send 'C:' to Linux remote
                const effectiveMount = this.resolveMount(diskMount, os)

                return timer(0, intervalMs).pipe(
                    switchMap(() => {
                        const command = os === 'linux'
                            ? getLinuxBatchCommand(effectiveMount)
                            : getWindowsBatchCommand(effectiveMount)

                        // Batch command has `sleep 1` inside, needs extra time
                        const timeout = Math.max(intervalMs * 3, 15000)

                        return from(this.remoteExec.exec(session, command, timeout)).pipe(
                            map(raw => {
                                const metrics = os === 'linux'
                                    ? parseLinuxBatchOutput(raw, effectiveMount)
                                    : parseWindowsBatchOutput(raw, effectiveMount)
                                metrics.host = displayHost
                                metrics.source = 'remote'
                                this.lastGoodMetrics.set(session.hostname, metrics)
                                return metrics
                            }),
                            catchError(err => {
                                console.debug('[tabby-sysmon] exec error:', String(err))
                                const cached = this.lastGoodMetrics.get(session.hostname)
                                if (cached) {
                                    return of({ ...cached, errors: { exec: String(err) }, partial: true })
                                }
                                const metrics = emptyMetrics('remote', displayHost)
                                metrics.errors['exec'] = String(err)
                                metrics.partial = true
                                return of(metrics)
                            }),
                        )
                    }),
                )
            }),
            catchError(err => {
                const metrics = emptyMetrics('remote', displayHost)
                metrics.errors['detectOS'] = String(err)
                metrics.partial = true
                return of(metrics)
            }),
        )
    }

    clearCacheForHost (hostname: string): void {
        this.lastGoodMetrics.delete(hostname)
    }

    private resolveMount (mount: string, os: RemoteOS): string {
        if (os === 'linux' && /^[A-Za-z]:/.test(mount)) {
            return '/'
        }
        if (os === 'windows' && (mount === '/' || mount.startsWith('/dev/'))) {
            return 'C:'
        }
        return mount
    }
}
