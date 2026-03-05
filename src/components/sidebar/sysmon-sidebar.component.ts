import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, OnDestroy } from '@angular/core'
import { Subscription } from 'rxjs'
import { SystemMetrics } from '../../interfaces/metrics'
import { MetricsOrchestratorService } from '../../services/metrics-orchestrator.service'
import { formatBytes, formatBytesPerSec, formatPercent, clampPercent } from '../../utils/format'

@Component({
    selector: 'sysmon-sidebar',
    template: require('./sysmon-sidebar.component.pug'),
    styles: [require('./sysmon-sidebar.component.scss')],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SysmonSidebarComponent implements OnInit, OnDestroy {
    @Input() height: number = 50
    @Input() showCpu: boolean = true
    @Input() showMemory: boolean = true
    @Input() showDisk: boolean = true
    @Input() showNetwork: boolean = true
    @Input() showConnections: boolean = true
    @Input() showSshSessions: boolean = true

    @Output() collapseToggled = new EventEmitter<boolean>()
    @Output() heightChanged = new EventEmitter<number>()
    @Output() heightLive = new EventEmitter<number>()

    currentMetrics: SystemMetrics | null = null
    collapsed: boolean = false
    displaySource: 'local' | 'remote' = 'local'
    displayHost: string = 'localhost'

    // Expose format utils for template
    formatBytes = formatBytes
    formatBytesPerSec = formatBytesPerSec
    formatPercent = formatPercent
    clampPercent = clampPercent

    private subscription: Subscription | null = null
    private collapsedSub: Subscription | null = null
    private resizing = false
    private rafId: number | null = null
    private boundMouseMove: ((e: MouseEvent) => void) | null = null
    private boundMouseUp: (() => void) | null = null

    constructor(
        private orchestrator: MetricsOrchestratorService,
        private cdr: ChangeDetectorRef,
    ) {}

    ngOnInit(): void {
        this.subscription = this.orchestrator.metrics$.subscribe(metrics => {
            this.currentMetrics = metrics
            if (metrics.memory.totalBytes > 0 || metrics.cpu.cores > 0) {
                this.displaySource = metrics.source
                this.displayHost = metrics.host
            }
            this.cdr.markForCheck()
        })
        this.collapsedSub = this.orchestrator.collapsed$.subscribe(collapsed => {
            this.collapsed = collapsed
            this.cdr.markForCheck()
        })
    }

    ngOnDestroy(): void {
        this.subscription?.unsubscribe()
        this.collapsedSub?.unsubscribe()
        if (this.boundMouseMove) {
            document.removeEventListener('mousemove', this.boundMouseMove)
            this.boundMouseMove = null
        }
        if (this.boundMouseUp) {
            document.removeEventListener('mouseup', this.boundMouseUp)
            this.boundMouseUp = null
        }
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId)
            this.rafId = null
        }
    }

    toggleCollapse(): void {
        this.orchestrator.setCollapsed(!this.collapsed)
        this.collapseToggled.emit(!this.collapsed)
    }

    getBarClass(percent: number): string {
        if (percent < 50) return 'bar-normal'
        if (percent < 80) return 'bar-warning'
        return 'bar-critical'
    }

    onResizeStart(event: MouseEvent): void {
        event.preventDefault()
        this.resizing = true
        const startY = event.clientY
        const startHeight = this.height

        const onMouseMove = (e: MouseEvent) => {
            const delta = e.clientY - startY
            // Handle is at top, dragging up = larger panel
            const newHeight = startHeight - delta
            this.height = Math.max(30, Math.min(400, newHeight))
            if (this.rafId === null) {
                this.rafId = requestAnimationFrame(() => {
                    this.heightLive.emit(this.height)
                    this.rafId = null
                })
            }
            this.cdr.markForCheck()
        }

        const onMouseUp = () => {
            if (this.rafId !== null) {
                cancelAnimationFrame(this.rafId)
                this.rafId = null
            }
            this.resizing = false
            document.removeEventListener('mousemove', onMouseMove)
            document.removeEventListener('mouseup', onMouseUp)
            this.boundMouseMove = null
            this.boundMouseUp = null
            this.heightChanged.emit(this.height)
        }

        this.boundMouseMove = onMouseMove
        this.boundMouseUp = onMouseUp
        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
    }
}
