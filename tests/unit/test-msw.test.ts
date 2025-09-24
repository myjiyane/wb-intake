import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { OcrResult } from '../../src/lib/api'
import { TestImages } from '../mocks/test-data'

// Mock the API module directly
vi.mock('../../src/lib/api', async () => {
  const actual = await vi.importActual('../../src/lib/api')
  return {
    ...actual,
    ocrVinFromImage: vi.fn().mockImplementation(async (file: File): Promise<OcrResult> => {
      console.log('Mocked ocrVinFromImage called with:', file.name)

      // Simulate validation
      if (file.size === 0) {
        throw new Error('File is empty. Please try taking the photo again.')
      }
      if (file.size < 1000 && file.type === 'image/jpeg') {
        throw new Error('Photo seems corrupted. Please try taking it again.')
      }

      // Return mock result based on filename
      return {
        ok: true,
        vin: 'AABCX12345K123456',
        vinValid: true,
        candidates: ['AABCX12345K123456'],
        confidence: 0.98,
        processingTime: 150,
        textExtracted: true,
        totalBlocks: 5,
        lineCount: 12,
        fromCache: false
      }
    }),
    ocrOdoFromImage: vi.fn()
  }
})

describe('API Mocking Test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('can mock VIN OCR API call', async () => {
    console.log('Testing direct API mocking...')

    const { ocrVinFromImage } = await import('../../src/lib/api')
    const testFile = TestImages.vinClear()
    console.log('Created test file:', testFile.name, testFile.size, 'bytes')

    const result = await ocrVinFromImage(testFile)
    console.log('VIN OCR result:', result)

    expect(result.ok).toBe(true)
    expect(result.vin).toBe('AABCX12345K123456')
    expect(result.vinValid).toBe(true)
    expect(result.confidence).toBeGreaterThanOrEqual(0.95)
  })
})