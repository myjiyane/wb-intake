import Tesseract from 'tesseract.js'

const VIN_RE = /[A-HJ-NPR-Z0-9]{11,17}/g // excludes I,O,Q

export async function extractVinFromImage(file: File) {
  const { data } = await Tesseract.recognize(file, 'eng', {
    // fast mode; adjust if needed
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  } as any)
  const raw = (data?.text || '').toUpperCase().replace(/[^A-Z0-9]/g, ' ')
  const candidates = (raw.match(VIN_RE) || [])
    .map(s => s.replace(/[IOQ]/g, '')) // normalize
  // prefer exact 17, else the longest candidate
  const best17 = candidates.find(s => s.length === 17)
  return best17 || candidates.sort((a,b) => b.length - a.length)[0] || ''
}
