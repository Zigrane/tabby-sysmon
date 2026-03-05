export function formatBytes (bytes: number): string {
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const k = 1024
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    const idx = Math.min(i, units.length - 1)
    return `${(bytes / Math.pow(k, idx)).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`
}

export function formatBytesPerSec (bytes: number): string {
    return `${formatBytes(bytes)}/s`
}

export function formatPercent (value: number): string {
    return `${clampPercent(value).toFixed(1)}%`
}

export function clampPercent (value: number): number {
    return Math.max(0, Math.min(100, value))
}
