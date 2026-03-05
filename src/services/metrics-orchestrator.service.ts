import { Injectable } from '@angular/core'
import { Observable, BehaviorSubject, combineLatest, of } from 'rxjs'
import { switchMap, map, startWith, distinctUntilChanged, shareReplay, catchError } from 'rxjs/operators'
import { ConfigService } from 'tabby-core'
import { SystemMetrics, emptyMetrics } from '../interfaces/metrics'
import { LocalMetricsService } from './local-metrics.service'
import { RemoteMetricsService } from './remote-metrics.service'
import { SSHSessionTrackerService } from './ssh-session-tracker.service'

@Injectable({ providedIn: 'root' })
export class MetricsOrchestratorService {
    metrics$: Observable<SystemMetrics>
    source$: Observable<'local' | 'remote'>
    collapsed$: BehaviorSubject<boolean>

    constructor (
        private config: ConfigService,
        private localMetrics: LocalMetricsService,
        private remoteMetrics: RemoteMetricsService,
        private sshTracker: SSHSessionTrackerService,
    ) {
        this.collapsed$ = new BehaviorSubject<boolean>(
            typeof window !== 'undefined' && window.localStorage.getItem('sysmonSidebarCollapsed') === 'true'
        )

        const config$ = this.config.changed$.pipe(
            startWith(undefined),
            map(() => this.getSysmonConfig()),
            distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        )

        this.metrics$ = combineLatest([
            config$,
            this.sshTracker.activeSSHSession$,
            this.collapsed$,
        ]).pipe(
            switchMap(([cfg, session, collapsed]) => {
                if (collapsed || !cfg.enabled) {
                    return of(emptyMetrics())
                }
                if (session && cfg.autoSwitchToRemote) {
                    return this.remoteMetrics.createMetricsStream(
                        session, cfg.refreshIntervalMs, cfg.diskMountPoint
                    ).pipe(
                        catchError(err => {
                            console.error('[tabby-sysmon] Remote metrics stream error, falling back to local:', err)
                            return this.localMetrics.createMetricsStream(
                                cfg.refreshIntervalMs, cfg.connectionsRefreshMultiplier, cfg.diskMountPoint
                            )
                        }),
                    )
                }
                return this.localMetrics.createMetricsStream(
                    cfg.refreshIntervalMs, cfg.connectionsRefreshMultiplier, cfg.diskMountPoint
                )
            }),
            catchError(err => {
                console.error('[tabby-sysmon] Orchestrator pipeline error:', err)
                return of(emptyMetrics())
            }),
            shareReplay(1),
        )

        this.source$ = this.metrics$.pipe(
            map(m => m.source),
            distinctUntilChanged(),
        )
    }

    setCollapsed (value: boolean): void {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem('sysmonSidebarCollapsed', String(value))
        }
        this.collapsed$.next(value)
    }

    getCollapsed (): boolean {
        return this.collapsed$.value
    }

    private getSysmonConfig () {
        return {
            enabled: this.config.store?.sysmon?.enabled ?? true,
            refreshIntervalMs: this.config.store?.sysmon?.refreshIntervalMs ?? 2000,
            panelHeight: this.config.store?.sysmon?.panelHeight ?? this.config.store?.sysmon?.sidebarWidth ?? 50,
            diskMountPoint: this.config.store?.sysmon?.diskMountPoint ?? '/',
            autoSwitchToRemote: this.config.store?.sysmon?.autoSwitchToRemote ?? true,
            connectionsRefreshMultiplier: this.config.store?.sysmon?.connectionsRefreshMultiplier ?? 3,
            showCpu: this.config.store?.sysmon?.showCpu ?? true,
            showMemory: this.config.store?.sysmon?.showMemory ?? true,
            showDisk: this.config.store?.sysmon?.showDisk ?? true,
            showNetwork: this.config.store?.sysmon?.showNetwork ?? true,
            showConnections: this.config.store?.sysmon?.showConnections ?? true,
            showSshSessions: this.config.store?.sysmon?.showSshSessions ?? true,
        }
    }
}
