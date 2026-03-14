const DSLR_EXTENSIONS = ['.cr2', '.cr3', '.arw']

export function isDslrFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  return DSLR_EXTENSIONS.some((ext) => lower.endsWith(ext))
}
