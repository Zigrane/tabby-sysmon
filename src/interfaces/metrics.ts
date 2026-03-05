export interface CpuMetrics {
    usagePercent: number
    cores: number
    processCount: number
}

export interface MemoryMetrics {
    usedBytes: number
    totalBytes: number
    usagePercent: number
}

export interface DiskMetrics {
    mount: string
    usedBytes: number
    totalBytes: number
    usagePercent: number
}

export interface NetworkMetrics {
    iface: string
    rxPerSec: number
    txPerSec: number
}

export interface ConnectionsMetrics {
    established: number
    sshSessions: number
}

export interface SystemMetrics {
    source: 'local' | 'remote'
    host: string
    timestamp: number
    cpu: CpuMetrics
    memory: MemoryMetrics
    disk: DiskMetrics
    network: NetworkMetrics
    connections: ConnectionsMetrics
    errors: Record<string, string>
    partial: boolean
}

export function emptyMetrics (source: 'local' | 'remote' = 'local', host: string = 'localhost'): SystemMetrics {
    return {
        source,
        host,
        timestamp: Date.now(),
        cpu: { usagePercent: 0, cores: 0, processCount: 0 },
        memory: { usedBytes: 0, totalBytes: 0, usagePercent: 0 },
        disk: { mount: '/', usedBytes: 0, totalBytes: 0, usagePercent: 0 },
        network: { iface: '', rxPerSec: 0, txPerSec: 0 },
        connections: { established: 0, sshSessions: 0 },
        errors: {},
        partial: false,
    }
}
