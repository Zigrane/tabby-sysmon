import {
    CpuMetrics,
    MemoryMetrics,
    DiskMetrics,
    NetworkMetrics,
    SystemMetrics,
    emptyMetrics,
} from '../interfaces/metrics'

const SECTION_DELIMITER = '===SECTION==='

export function getWindowsBatchCommand(mount: string): string {
    const escapedMount = mount.replace(/'/g, "''")
    const script = [
        // CPU: average load percentage + logical processor count
        `$cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue`,
        `$avg = ($cpu | Measure-Object -Property LoadPercentage -Average).Average`,
        `$cores = ($cpu | Select-Object -First 1).NumberOfLogicalProcessors`,
        `Write-Output "Average:$avg"`,
        `Write-Output "Cores:$cores"`,
        `Write-Output '${SECTION_DELIMITER}'`,

        // MEMORY: total and free in KB from Win32_OperatingSystem
        `$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue`,
        `Write-Output "TotalVisibleMemorySize:$($os.TotalVisibleMemorySize)"`,
        `Write-Output "FreePhysicalMemory:$($os.FreePhysicalMemory)"`,
        `Write-Output '${SECTION_DELIMITER}'`,

        // DISK: size and free space for the given mount
        `$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${escapedMount}'" -ErrorAction SilentlyContinue`,
        `Write-Output "Size:$($disk.Size)"`,
        `Write-Output "FreeSpace:$($disk.FreeSpace)"`,
        `Write-Output '${SECTION_DELIMITER}'`,

        // NET before: first snapshot of adapter statistics
        `$netBefore = Get-NetAdapterStatistics -ErrorAction SilentlyContinue | Select-Object Name, ReceivedBytes, SentBytes`,
        `foreach ($a in $netBefore) { Write-Output "$($a.Name)|$($a.ReceivedBytes)|$($a.SentBytes)" }`,
        `Write-Output '${SECTION_DELIMITER}'`,

        // Sleep 1 second for network delta
        `Start-Sleep -Seconds 1`,
        `Write-Output '${SECTION_DELIMITER}'`,

        // NET after: second snapshot
        `$netAfter = Get-NetAdapterStatistics -ErrorAction SilentlyContinue | Select-Object Name, ReceivedBytes, SentBytes`,
        `foreach ($a in $netAfter) { Write-Output "$($a.Name)|$($a.ReceivedBytes)|$($a.SentBytes)" }`,
        `Write-Output '${SECTION_DELIMITER}'`,

        // CONNECTIONS: count of established TCP connections
        `$conn = (Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue).Count`,
        `if ($conn -eq $null) { $conn = 0 }`,
        `Write-Output $conn`,
        `Write-Output '${SECTION_DELIMITER}'`,

        // PROCESSES: total process count
        `Write-Output (Get-Process).Count`,
        `Write-Output '${SECTION_DELIMITER}'`,

        // SSH SESSIONS: count of interactive user sessions (quser)
        `try { $q = (quser 2>$null | Select-Object -Skip 1 | Measure-Object -Line).Lines; if ($q -eq $null) { $q = 0 }; Write-Output $q } catch { Write-Output 0 }`,
    ].join('; ')

    return `powershell -NoProfile -Command "${script}"`
}

export function parseCpuLoad(raw: string): CpuMetrics {
    const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean)
    let usagePercent = 0
    let cores = 0

    for (const line of lines) {
        if (line.startsWith('Average:')) {
            const val = parseFloat(line.split(':')[1])
            if (!isNaN(val)) usagePercent = val
        } else if (line.startsWith('Cores:')) {
            const val = parseInt(line.split(':')[1], 10)
            if (!isNaN(val)) cores = val
        }
    }

    return { usagePercent, cores, processCount: 0 }
}

export function parseMemory(raw: string): MemoryMetrics {
    const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean)
    let totalKB = 0
    let freeKB = 0

    for (const line of lines) {
        if (line.startsWith('TotalVisibleMemorySize:')) {
            const val = parseFloat(line.split(':')[1])
            if (!isNaN(val)) totalKB = val
        } else if (line.startsWith('FreePhysicalMemory:')) {
            const val = parseFloat(line.split(':')[1])
            if (!isNaN(val)) freeKB = val
        }
    }

    const totalBytes = totalKB * 1024
    const usedBytes = (totalKB - freeKB) * 1024
    const usagePercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0

    return { totalBytes, usedBytes, usagePercent }
}

export function parseDisk(raw: string, mount: string): DiskMetrics {
    const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean)
    let size = 0
    let freeSpace = 0

    for (const line of lines) {
        if (line.startsWith('Size:')) {
            const val = parseFloat(line.split(':')[1])
            if (!isNaN(val)) size = val
        } else if (line.startsWith('FreeSpace:')) {
            const val = parseFloat(line.split(':')[1])
            if (!isNaN(val)) freeSpace = val
        }
    }

    const totalBytes = size
    if (totalBytes === 0 || isNaN(totalBytes) || isNaN(freeSpace)) {
        return { mount, totalBytes: 0, usedBytes: 0, usagePercent: 0 }
    }
    const usedBytes = size - freeSpace
    const usagePercent = (usedBytes / totalBytes) * 100

    return { mount, totalBytes, usedBytes, usagePercent }
}

interface NetAdapterEntry {
    name: string
    receivedBytes: number
    sentBytes: number
}

function parseNetAdapterLines(raw: string): NetAdapterEntry[] {
    const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean)
    const entries: NetAdapterEntry[] = []

    for (const line of lines) {
        const parts = line.split('|')
        if (parts.length >= 3) {
            const name = parts[0]
            const receivedBytes = parseFloat(parts[1]) || 0
            const sentBytes = parseFloat(parts[2]) || 0
            entries.push({ name, receivedBytes, sentBytes })
        }
    }

    return entries
}

export function parseNetworkStats(
    beforeRaw: string,
    afterRaw: string,
    deltaSec: number = 1
): NetworkMetrics {
    const before = parseNetAdapterLines(beforeRaw)
    const after = parseNetAdapterLines(afterRaw)

    if (after.length === 0 || before.length === 0) {
        return { iface: '', rxPerSec: 0, txPerSec: 0 }
    }

    // Match by name, pick the adapter with most traffic
    let bestIface = ''
    let bestRx = 0
    let bestTx = 0

    for (const a of after) {
        const b = before.find(e => e.name === a.name)
        if (!b) continue

        const rxDelta = Math.max(0, a.receivedBytes - b.receivedBytes)
        const txDelta = Math.max(0, a.sentBytes - b.sentBytes)
        const total = rxDelta + txDelta

        if (total > bestRx + bestTx || bestIface === '') {
            bestIface = a.name
            bestRx = rxDelta
            bestTx = txDelta
        }
    }

    const sec = deltaSec > 0 ? deltaSec : 1

    return {
        iface: bestIface,
        rxPerSec: Math.round(bestRx / sec),
        txPerSec: Math.round(bestTx / sec),
    }
}

export function parseConnectionsCount(raw: string): number {
    const trimmed = raw.trim()
    const val = parseInt(trimmed, 10)
    return isNaN(val) ? 0 : val
}

export function parseWindowsBatchOutput(raw: string, mount: string): SystemMetrics {
    const metrics = emptyMetrics('remote', 'unknown')
    metrics.timestamp = Date.now()

    const sections = raw.split(SECTION_DELIMITER)
    // Expected: [CPU, MEM, DISK, NET_BEFORE, SLEEP_MARKER, NET_AFTER, CONNECTIONS, PROCESSES, SSH_SESSIONS]
    // Minimum 9 sections expected

    // CPU
    try {
        if (sections[0]) {
            metrics.cpu = parseCpuLoad(sections[0])
        }
    } catch (err: any) {
        metrics.errors['cpu'] = err?.message || 'Failed to parse CPU'
        metrics.partial = true
    }

    // Memory
    try {
        if (sections[1]) {
            metrics.memory = parseMemory(sections[1])
        }
    } catch (err: any) {
        metrics.errors['memory'] = err?.message || 'Failed to parse memory'
        metrics.partial = true
    }

    // Disk
    try {
        if (sections[2]) {
            metrics.disk = parseDisk(sections[2], mount)
        }
    } catch (err: any) {
        metrics.errors['disk'] = err?.message || 'Failed to parse disk'
        metrics.partial = true
    }

    // Network (before = sections[3], sleep = sections[4], after = sections[5])
    try {
        if (sections[3] && sections[5]) {
            metrics.network = parseNetworkStats(sections[3], sections[5], 1)
        }
    } catch (err: any) {
        metrics.errors['network'] = err?.message || 'Failed to parse network'
        metrics.partial = true
    }

    // Connections
    try {
        if (sections[6]) {
            metrics.connections = { established: parseConnectionsCount(sections[6]), sshSessions: 0 }
        }
    } catch (err: any) {
        metrics.errors['connections'] = err?.message || 'Failed to parse connections'
        metrics.partial = true
    }

    // Processes
    try {
        if (sections[7]) {
            metrics.cpu.processCount = parseConnectionsCount(sections[7])
        }
    } catch (err: any) {
        metrics.errors['processes'] = err?.message || 'Failed to parse processes'
        metrics.partial = true
    }

    // SSH Sessions
    try {
        if (sections[8]) {
            metrics.connections.sshSessions = parseConnectionsCount(sections[8])
        }
    } catch (err: any) {
        metrics.errors['ssh_sessions'] = err?.message || 'Failed to parse SSH sessions'
        metrics.partial = true
    }

    return metrics
}
