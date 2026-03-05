import { SystemMetrics, emptyMetrics } from '../interfaces/metrics'

// --- Types ---

interface ProcStatValues {
    user: number
    nice: number
    system: number
    idle: number
    iowait: number
    irq: number
    softirq: number
    steal: number
}

interface NetDevEntry {
    iface: string
    rxBytes: number
    txBytes: number
}

// --- Batch command ---

const LINUX_FULL_BATCH_COMMAND = [
    'cat /proc/stat',
    'echo "===SECTION==="',
    'cat /proc/meminfo',
    'echo "===SECTION==="',
    '(df -P -B1 __MOUNT__ 2>/dev/null || df -B1 __MOUNT__ 2>/dev/null || df __MOUNT__)',
    'echo "===SECTION==="',
    'cat /proc/net/dev',
    'echo "===SECTION==="',
    '(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo || echo 1)',
    'echo "===SECTION==="',
    '{ grep " 01 " /proc/net/tcp /proc/net/tcp6 2>/dev/null | wc -l; } || echo 0',
    'echo "===SECTION==="',
    '(ls -1d /proc/[0-9]* 2>/dev/null | wc -l) || echo 0',
    'echo "===SECTION==="',
    '(who 2>/dev/null | wc -l) || echo 0',
    'echo "===SECTION==="',
    'sleep 1',
    'cat /proc/stat',
    'echo "===SECTION==="',
    'cat /proc/net/dev',
].join(' ; ')

export function getLinuxBatchCommand(mount: string): string {
    return LINUX_FULL_BATCH_COMMAND.replace(/__MOUNT__/g, mount)
}

// --- Individual parsers ---

export function parseProcStat(raw: string): ProcStatValues {
    const lines = raw.trim().split('\n')
    const cpuLine = lines.find(l => l.startsWith('cpu '))
    if (!cpuLine) throw new Error('No aggregated cpu line found in /proc/stat')
    const parts = cpuLine.trim().split(/\s+/)
    // cpu user nice system idle iowait irq softirq steal ...
    return {
        user: parseInt(parts[1], 10),
        nice: parseInt(parts[2], 10),
        system: parseInt(parts[3], 10),
        idle: parseInt(parts[4], 10),
        iowait: parseInt(parts[5], 10) || 0,
        irq: parseInt(parts[6], 10) || 0,
        softirq: parseInt(parts[7], 10) || 0,
        steal: parseInt(parts[8], 10) || 0,
    }
}

export function calcCpuPercent(before: ProcStatValues, after: ProcStatValues): number {
    const totalBefore = before.user + before.nice + before.system + before.idle
        + before.iowait + before.irq + before.softirq + before.steal
    const totalAfter = after.user + after.nice + after.system + after.idle
        + after.iowait + after.irq + after.softirq + after.steal
    const deltaTotal = totalAfter - totalBefore
    const deltaIdle = (after.idle + after.iowait) - (before.idle + before.iowait)
    if (deltaTotal === 0) return 0
    return ((1 - deltaIdle / deltaTotal) * 100)
}

export function parseMeminfo(raw: string): { totalBytes: number; availableBytes: number; usedBytes: number; usagePercent: number } {
    const lines = raw.trim().split('\n')
    const getValue = (key: string): number => {
        const line = lines.find(l => l.startsWith(key + ':'))
        if (!line) return 0
        const match = line.match(/(\d+)/)
        return match ? parseInt(match[1], 10) * 1024 : 0 // /proc/meminfo values are in kB
    }

    const totalBytes = getValue('MemTotal')
    let availableBytes = getValue('MemAvailable')
    if (availableBytes === 0) {
        availableBytes = getValue('MemFree') + getValue('Buffers') + getValue('Cached')
    }
    const usedBytes = totalBytes - availableBytes
    const usagePercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0

    return { totalBytes, availableBytes, usedBytes, usagePercent }
}

export function parseDf(raw: string): { mount: string; totalBytes: number; usedBytes: number; usagePercent: number } {
    const lines = raw.trim().split('\n').filter(l => l.length > 0)
    if (lines.length < 2) {
        return { mount: '/', totalBytes: 0, usedBytes: 0, usagePercent: 0 }
    }
    // Join all data lines (skip header) to handle LVM/wrapped filesystem names
    const dataStr = lines.slice(1).join(' ')
    const tokens = dataStr.trim().split(/\s+/)

    // Find the '%' token as anchor (e.g. "53%")
    const pctIdx = tokens.findIndex(t => t.endsWith('%'))
    if (pctIdx < 3) {
        return { mount: '/', totalBytes: 0, usedBytes: 0, usagePercent: 0 }
    }

    const totalBytes = parseInt(tokens[pctIdx - 3], 10)
    const usedBytes = parseInt(tokens[pctIdx - 2], 10)
    const usagePercent = parseInt(tokens[pctIdx].replace('%', ''), 10)
    const mount = tokens[pctIdx + 1] || '/'

    if (isNaN(totalBytes) || isNaN(usedBytes) || isNaN(usagePercent)) {
        return { mount: '/', totalBytes: 0, usedBytes: 0, usagePercent: 0 }
    }

    return { mount, totalBytes, usedBytes, usagePercent }
}

export function parseProcNetDev(raw: string): NetDevEntry[] {
    const lines = raw.trim().split('\n')
    const result: NetDevEntry[] = []
    for (const line of lines) {
        // Skip header lines (contain | or no colon)
        if (!line.includes(':') || line.includes('|')) continue
        const [ifacePart, rest] = line.split(':')
        const iface = ifacePart.trim()
        if (iface === 'lo') continue
        const parts = rest.trim().split(/\s+/)
        // bytes packets errs drop fifo frame compressed multicast | bytes packets ...
        const rxBytes = parseInt(parts[0], 10)
        const txBytes = parseInt(parts[8], 10)
        result.push({ iface, rxBytes, txBytes })
    }
    return result
}

export function calcNetworkDelta(
    before: NetDevEntry[],
    after: NetDevEntry[],
    deltaSec: number
): { iface: string; rxPerSec: number; txPerSec: number } {
    if (deltaSec <= 0) deltaSec = 1
    // Find first matching interface in after that also exists in before
    for (const a of after) {
        const b = before.find(e => e.iface === a.iface)
        if (!b) continue
        return {
            iface: a.iface,
            rxPerSec: Math.max(0, (a.rxBytes - b.rxBytes) / deltaSec),
            txPerSec: Math.max(0, (a.txBytes - b.txBytes) / deltaSec),
        }
    }
    return { iface: '', rxPerSec: 0, txPerSec: 0 }
}

export function parseConnectionsCount(raw: string): number {
    const n = parseInt(raw.trim(), 10)
    return isNaN(n) ? 0 : n
}

export function parseCoresCount(raw: string): number {
    const n = parseInt(raw.trim(), 10)
    return isNaN(n) ? 1 : n
}

export function parseProcessCount(raw: string): number {
    const n = parseInt(raw.trim(), 10)
    return isNaN(n) ? 0 : n
}

// --- Main parser ---

export function parseLinuxBatchOutput(raw: string, mount: string): SystemMetrics {
    const metrics = emptyMetrics('remote', 'unknown')
    const sections = raw.split('===SECTION===')

    // Expected order:
    // 0: CPU_BEFORE, 1: MEM, 2: DISK, 3: NET_BEFORE,
    // 4: CORES, 5: CONNECTIONS, 6: PROCESSES, 7: SSH_SESSIONS,
    // [sleep 1], 8: CPU_AFTER, 9: NET_AFTER

    let cpuBefore: ProcStatValues | null = null
    let cpuAfter: ProcStatValues | null = null
    let netBefore: NetDevEntry[] | null = null
    let netAfter: NetDevEntry[] | null = null
    let cores = 1

    // CPU BEFORE (section 0)
    try {
        cpuBefore = parseProcStat(sections[0])
    } catch (e: any) {
        metrics.errors['cpu_before'] = e.message
        metrics.partial = true
    }

    // MEMORY (section 1)
    try {
        const mem = parseMeminfo(sections[1])
        metrics.memory = {
            usedBytes: mem.usedBytes,
            totalBytes: mem.totalBytes,
            usagePercent: mem.usagePercent,
        }
    } catch (e: any) {
        metrics.errors['memory'] = e.message
        metrics.partial = true
    }

    // DISK (section 2)
    try {
        console.debug('[tabby-sysmon] df raw section:', JSON.stringify(sections[2]?.substring(0, 300)))
        const disk = parseDf(sections[2])
        console.debug('[tabby-sysmon] df parsed:', disk)
        metrics.disk = {
            mount: disk.mount,
            usedBytes: disk.usedBytes,
            totalBytes: disk.totalBytes,
            usagePercent: disk.usagePercent,
        }
    } catch (e: any) {
        metrics.errors['disk'] = e.message
        metrics.partial = true
    }

    // NET BEFORE (section 3)
    try {
        netBefore = parseProcNetDev(sections[3])
    } catch (e: any) {
        metrics.errors['net_before'] = e.message
        metrics.partial = true
    }

    // CORES (section 4)
    try {
        cores = parseCoresCount(sections[4])
        metrics.cpu.cores = cores
    } catch (e: any) {
        metrics.errors['cores'] = e.message
        metrics.partial = true
    }

    // CONNECTIONS (section 5)
    try {
        metrics.connections.established = parseConnectionsCount(sections[5])
    } catch (e: any) {
        metrics.errors['connections'] = e.message
        metrics.partial = true
    }

    // PROCESSES (section 6)
    try {
        metrics.cpu.processCount = parseProcessCount(sections[6])
    } catch (e: any) {
        metrics.errors['processes'] = e.message
        metrics.partial = true
    }

    // SSH SESSIONS (section 7)
    try {
        const count = parseInt(sections[7]?.trim(), 10)
        metrics.connections.sshSessions = isNaN(count) ? 0 : count
    } catch (e: any) {
        metrics.errors['ssh_sessions'] = e.message
        metrics.partial = true
    }

    // CPU AFTER (section 8)
    try {
        cpuAfter = parseProcStat(sections[8])
    } catch (e: any) {
        metrics.errors['cpu_after'] = e.message
        metrics.partial = true
    }

    // NET AFTER (section 9)
    try {
        netAfter = parseProcNetDev(sections[9])
    } catch (e: any) {
        metrics.errors['net_after'] = e.message
        metrics.partial = true
    }

    // Calculate CPU percent from deltas
    if (cpuBefore && cpuAfter) {
        metrics.cpu.usagePercent = calcCpuPercent(cpuBefore, cpuAfter)
    } else {
        metrics.errors['cpu'] = 'Missing before/after CPU data'
        metrics.partial = true
    }

    // Calculate network delta (deltaSec = 1 from sleep 1)
    if (netBefore && netAfter) {
        const net = calcNetworkDelta(netBefore, netAfter, 1)
        metrics.network = net
    } else {
        metrics.errors['network'] = 'Missing before/after network data'
        metrics.partial = true
    }

    metrics.timestamp = Date.now()
    return metrics
}
