import { Injectable } from '@angular/core'
import { Observable, timer, of, combineLatest, from } from 'rxjs'
import { switchMap, map, shareReplay, catchError, filter } from 'rxjs/operators'
import { SystemMetrics, emptyMetrics } from '../interfaces/metrics'

let si: any = null
try {
    si = require('systeminformation')
} catch {
    console.warn('[tabby-sysmon] systeminformation not available, using os fallback')
}

const os = require('os')

@Injectable({ providedIn: 'root' })
export class LocalMetricsService {
    private lastCpuTimes: { idle: number; total: number } | null = null

    createMetricsStream (intervalMs: number = 3000, connectionsMultiplier: number = 3, diskMountPoint: string = '/'): Observable<SystemMetrics> {
        const mainMetrics$ = timer(0, intervalMs).pipe(
            switchMap(() => from(this.collectMainMetrics(diskMountPoint))),
            catchError(err => {
                console.error('[tabby-sysmon] local metrics error:', err)
                return of(emptyMetrics('local'))
            }),
        )

        const connections$ = timer(0, intervalMs * connectionsMultiplier).pipe(
            switchMap(() => from(this.collectConnections())),
            catchError(() => of(0)),
            shareReplay(1),
        )

        const processCount$ = timer(0, intervalMs * connectionsMultiplier).pipe(
            switchMap(() => from(this.collectProcessCount())),
            catchError(() => of(0)),
            shareReplay(1),
        )

        return combineLatest([mainMetrics$, connections$, processCount$]).pipe(
            map(([metrics, established, processCount]) => ({
                ...metrics,
                cpu: { ...metrics.cpu, processCount },
                connections: { established, sshSessions: 0 },
            })),
        )
    }

    private async collectMainMetrics (diskMountPoint: string): Promise<SystemMetrics> {
        const metrics = emptyMetrics('local', os.hostname())

        try {
            if (si) {
                await this.collectWithSI(metrics, diskMountPoint)
            } else {
                this.collectWithOS(metrics)
            }
        } catch (err) {
            metrics.errors.main = String(err)
            metrics.partial = true
        }

        metrics.timestamp = Date.now()
        return metrics
    }

    private async collectWithSI (metrics: SystemMetrics, diskMountPoint: string): Promise<void> {
        try {
            const load = await si.currentLoad()
            metrics.cpu.usagePercent = load.currentLoad ?? 0
            metrics.cpu.cores = load.cpus?.length ?? os.cpus().length
        } catch (err) {
            metrics.errors.cpu = String(err)
            metrics.partial = true
        }

        try {
            const mem = await si.mem()
            metrics.memory.totalBytes = mem.total ?? 0
            metrics.memory.usedBytes = mem.active ?? 0
            metrics.memory.usagePercent = mem.total ? (mem.active / mem.total) * 100 : 0
        } catch (err) {
            metrics.errors.memory = String(err)
            metrics.partial = true
        }

        try {
            const disks = await si.fsSize()
            const disk = disks.find((d: any) => d.mount === diskMountPoint) ?? disks[0]
            if (disk) {
                metrics.disk.mount = disk.mount
                metrics.disk.totalBytes = disk.size ?? 0
                metrics.disk.usedBytes = disk.used ?? 0
                metrics.disk.usagePercent = disk.use ?? 0
            }
        } catch (err) {
            metrics.errors.disk = String(err)
            metrics.partial = true
        }

        try {
            const nets = await si.networkStats()
            const net = nets.find((n: any) => n.iface !== 'lo') ?? nets[0]
            if (net) {
                metrics.network.iface = net.iface
                metrics.network.rxPerSec = net.rx_sec >= 0 ? net.rx_sec : 0
                metrics.network.txPerSec = net.tx_sec >= 0 ? net.tx_sec : 0
            }
        } catch (err) {
            metrics.errors.network = String(err)
            metrics.partial = true
        }
    }

    private collectWithOS (metrics: SystemMetrics): void {
        const cpus = os.cpus()
        metrics.cpu.cores = cpus.length

        let totalIdle = 0
        let totalTick = 0
        for (const cpu of cpus) {
            const { user, nice, sys, idle, irq } = cpu.times
            totalTick += user + nice + sys + idle + irq
            totalIdle += idle
        }

        if (this.lastCpuTimes) {
            const idleDelta = totalIdle - this.lastCpuTimes.idle
            const totalDelta = totalTick - this.lastCpuTimes.total
            metrics.cpu.usagePercent = totalDelta > 0 ? ((1 - idleDelta / totalDelta) * 100) : 0
        }
        this.lastCpuTimes = { idle: totalIdle, total: totalTick }

        const totalMem = os.totalmem()
        const freeMem = os.freemem()
        metrics.memory.totalBytes = totalMem
        metrics.memory.usedBytes = totalMem - freeMem
        metrics.memory.usagePercent = totalMem ? ((totalMem - freeMem) / totalMem) * 100 : 0
    }

    private async collectProcessCount (): Promise<number> {
        if (!si) return 0
        try {
            const procs = await si.processes()
            return procs.all ?? 0
        } catch {
            return 0
        }
    }

    private async collectConnections (): Promise<number> {
        if (!si) return 0
        try {
            const conns = await si.networkConnections()
            return conns.filter((c: any) => c.state === 'ESTABLISHED').length
        } catch {
            return 0
        }
    }
}
