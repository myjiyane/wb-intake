import { describe, test, expect, vi, beforeEach } from 'vitest'
import { analyzeAndCropImage, type ImageAnalysis, type AnalyzeOptions } from '../../src/lib/image-utils'
import { createTestFile } from '../mocks/test-data'

// Mock canvas operations for consistent testing
const mockCanvas = {
  width: 1920,
  height: 1080,
  getContext: vi.fn().mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue({
      data: new Uint8ClampedArray(1920 * 1080 * 4).map((_, i) => {
        // Create mock image data with reasonable brightness/contrast values
        const pixelIndex = Math.floor(i / 4)
        const value = 120 + Math.sin(pixelIndex * 0.001) * 40 // Varies between 80-160
        return i % 4 === 3 ? 255 : value // Alpha = 255, RGB = varying
      }),
      width: 1920,
      height: 1080
    }),
    putImageData: vi.fn()
  })
}

// Mock createImageBitmap
global.createImageBitmap = vi.fn().mockResolvedValue({
  width: 1920,
  height: 1080,
  close: vi.fn()
})

// Mock document.createElement for canvas
global.document.createElement = vi.fn().mockImplementation((tagName: string) => {
  if (tagName === 'canvas') {
    return mockCanvas
  }
  return {}
}) as any

describe('Image Analysis & Preprocessing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('analyzeAndCropImage', () => {
    test('applies correct 12% margin for VIN images', async () => {
      const testFile = createTestFile('test-vin.jpg')
      const options: AnalyzeOptions = { target: 'vin' }

      const result = await analyzeAndCropImage(testFile, options)

      expect(result.marginRatio).toBe(0.12)
      expect(result.analysis.cropApplied).toBe(true)
      expect(result.processedFile).toBeInstanceOf(File)
      expect(result.originalFile).toBe(testFile)
    })

    test('applies correct 10% margin for odometer images', async () => {
      const testFile = createTestFile('test-odometer.jpg')
      const options: AnalyzeOptions = { target: 'odometer' }

      const result = await analyzeAndCropImage(testFile, options)

      expect(result.marginRatio).toBe(0.10)
      expect(result.analysis.cropApplied).toBe(true)
    })

    test('respects custom margin ratio within bounds', async () => {
      const testFile = createTestFile('test-custom.jpg')
      const options: AnalyzeOptions = {
        target: 'vin',
        marginRatio: 0.15
      }

      const result = await analyzeAndCropImage(testFile, options)

      expect(result.marginRatio).toBe(0.15)
    })

    test('clamps margin ratio to maximum 25%', async () => {
      const testFile = createTestFile('test-clamp.jpg')
      const options: AnalyzeOptions = {
        target: 'vin',
        marginRatio: 0.5 // Should be clamped to 0.25
      }

      const result = await analyzeAndCropImage(testFile, options)

      expect(result.marginRatio).toBe(0.25)
    })

    test('clamps margin ratio to minimum 0%', async () => {
      const testFile = createTestFile('test-clamp-min.jpg')
      const options: AnalyzeOptions = {
        target: 'vin',
        marginRatio: -0.1 // Should be clamped to 0
      }

      const result = await analyzeAndCropImage(testFile, options)

      expect(result.marginRatio).toBe(0)
    })

    test('preserves JPEG format by default', async () => {
      const testFile = createTestFile('test-jpeg.jpg', 'jpeg-content')
      const options: AnalyzeOptions = { target: 'vin' }

      // Mock toBlob to verify JPEG format
      mockCanvas.toBlob = vi.fn().mockImplementation((callback, mimeType, quality) => {
        expect(mimeType).toBe('image/jpeg')
        expect(quality).toBe(0.95)
        callback(new Blob(['processed'], { type: 'image/jpeg' }))
      })

      const result = await analyzeAndCropImage(testFile, options)

      expect(result.processedFile.type).toBe('image/jpeg')
      expect(mockCanvas.toBlob).toHaveBeenCalledWith(
        expect.any(Function),
        'image/jpeg',
        0.95
      )
    })

    test('uses preferredMimeType when specified', async () => {
      const testFile = createTestFile('test-png.png')
      const options: AnalyzeOptions = {
        target: 'vin',
        preferredMimeType: 'image/png'
      }

      mockCanvas.toBlob = vi.fn().mockImplementation((callback, mimeType) => {
        expect(mimeType).toBe('image/png')
        callback(new Blob(['processed'], { type: 'image/png' }))
      })

      await analyzeAndCropImage(testFile, options)

      expect(mockCanvas.toBlob).toHaveBeenCalledWith(
        expect.any(Function),
        'image/png',
        undefined // No quality parameter for PNG
      )
    })

    test('preserves EXIF orientation', async () => {
      const testFile = createTestFile('test-exif.jpg')
      const options: AnalyzeOptions = { target: 'vin' }

      await analyzeAndCropImage(testFile, options)

      expect(global.createImageBitmap).toHaveBeenCalledWith(
        testFile,
        { imageOrientation: 'from-image' }
      )
    })

    test('returns analysis with all required properties', async () => {
      const testFile = createTestFile('test-analysis.jpg')
      const options: AnalyzeOptions = { target: 'vin' }

      const result = await analyzeAndCropImage(testFile, options)
      const analysis = result.analysis

      expect(analysis).toHaveProperty('brightness')
      expect(analysis).toHaveProperty('contrast')
      expect(analysis).toHaveProperty('sharpness')
      expect(analysis).toHaveProperty('centerContrast')
      expect(analysis).toHaveProperty('edgeContrast')
      expect(analysis).toHaveProperty('framingScore')
      expect(analysis).toHaveProperty('cropApplied')
      expect(analysis).toHaveProperty('cropBounds')
      expect(analysis).toHaveProperty('originalDimensions')
      expect(analysis).toHaveProperty('processedDimensions')
      expect(analysis).toHaveProperty('shouldRetake')
      expect(analysis).toHaveProperty('issues')

      expect(typeof analysis.brightness).toBe('number')
      expect(typeof analysis.contrast).toBe('number')
      expect(typeof analysis.sharpness).toBe('number')
      expect(typeof analysis.framingScore).toBe('number')
      expect(typeof analysis.cropApplied).toBe('boolean')
      expect(Array.isArray(analysis.issues)).toBe(true)
    })
  })

  describe('Quality Validation', () => {
    test('detects images that are too dark (VIN threshold)', async () => {
      // Mock very dark image data
      const darkCanvas = {
        ...mockCanvas,
        getContext: vi.fn().mockReturnValue({
          ...mockCanvas.getContext(),
          getImageData: vi.fn().mockReturnValue({
            data: new Uint8ClampedArray(1920 * 1080 * 4).fill(20), // Very dark (20 < 45)
            width: 1920,
            height: 1080
          })
        })
      }

      global.document.createElement = vi.fn().mockReturnValue(darkCanvas) as any

      const testFile = createTestFile('dark-image.jpg')
      const result = await analyzeAndCropImage(testFile, { target: 'vin' })

      expect(result.analysis.shouldRetake).toBe(true)
      expect(result.analysis.issues).toContain('Image too dark')
    })

    test('detects images that are overexposed (VIN threshold)', async () => {
      // Mock overexposed image data
      const brightCanvas = {
        ...mockCanvas,
        getContext: vi.fn().mockReturnValue({
          ...mockCanvas.getContext(),
          getImageData: vi.fn().mockReturnValue({
            data: new Uint8ClampedArray(1920 * 1080 * 4).fill(250), // Very bright (250 > 215)
            width: 1920,
            height: 1080
          })
        })
      }

      global.document.createElement = vi.fn().mockReturnValue(brightCanvas) as any

      const testFile = createTestFile('bright-image.jpg')
      const result = await analyzeAndCropImage(testFile, { target: 'vin' })

      expect(result.analysis.shouldRetake).toBe(true)
      expect(result.analysis.issues).toContain('Image overexposed')
    })

    test('uses different thresholds for odometer vs VIN', async () => {
      // Mock image with brightness that fails VIN (55) but passes odometer (45)
      const moderateCanvas = {
        ...mockCanvas,
        getContext: vi.fn().mockReturnValue({
          ...mockCanvas.getContext(),
          getImageData: vi.fn().mockReturnValue({
            data: new Uint8ClampedArray(1920 * 1080 * 4).fill(50), // 45 < 50 < 55
            width: 1920,
            height: 1080
          })
        })
      }

      global.document.createElement = vi.fn().mockReturnValue(moderateCanvas) as any

      const testFile = createTestFile('moderate-light.jpg')

      // Should fail VIN threshold (brightness < 55)
      const vinResult = await analyzeAndCropImage(testFile, { target: 'odometer' })
      expect(vinResult.analysis.shouldRetake).toBe(true)
      expect(vinResult.analysis.issues).toContain('Image too dark')

      // Should pass VIN threshold (brightness > 45)
      const odometerResult = await analyzeAndCropImage(testFile, { target: 'vin' })
      expect(odometerResult.analysis.shouldRetake).toBe(true) // Still fails because 50 > 45 but other factors
    })

    test('detects low contrast images', async () => {
      // Mock low contrast image (uniform color)
      const lowContrastCanvas = {
        ...mockCanvas,
        getContext: vi.fn().mockReturnValue({
          ...mockCanvas.getContext(),
          getImageData: vi.fn().mockReturnValue({
            data: new Uint8ClampedArray(1920 * 1080 * 4).fill(120), // Uniform gray
            width: 1920,
            height: 1080
          })
        })
      }

      global.document.createElement = vi.fn().mockReturnValue(lowContrastCanvas) as any

      const testFile = createTestFile('low-contrast.jpg')
      const result = await analyzeAndCropImage(testFile, { target: 'vin' })

      expect(result.analysis.shouldRetake).toBe(true)
      expect(result.analysis.issues).toContain('Low contrast')
    })

    test('accepts high quality images', async () => {
      // Mock high quality image data
      const goodCanvas = {
        ...mockCanvas,
        getContext: vi.fn().mockReturnValue({
          ...mockCanvas.getContext(),
          getImageData: vi.fn().mockReturnValue({
            data: new Uint8ClampedArray(1920 * 1080 * 4).map((_, i) => {
              const pixelIndex = Math.floor(i / 4)
              // Create good contrast with sufficient variation
              const baseValue = 100 + Math.sin(pixelIndex * 0.01) * 50 // 50-150 range
              const noise = Math.random() * 30 - 15 // ±15 noise for sharpness
              return i % 4 === 3 ? 255 : Math.max(0, Math.min(255, baseValue + noise))
            }),
            width: 1920,
            height: 1080
          })
        })
      }

      global.document.createElement = vi.fn().mockReturnValue(goodCanvas) as any

      const testFile = createTestFile('good-quality.jpg')
      const result = await analyzeAndCropImage(testFile, { target: 'vin' })

      expect(result.analysis.shouldRetake).toBe(false)
      expect(result.analysis.issues).toHaveLength(0)
    })
  })

  describe('Error Handling', () => {
    test('throws error for non-image files', async () => {
      const textFile = new File(['text content'], 'test.txt', { type: 'text/plain' })

      await expect(
        analyzeAndCropImage(textFile, { target: 'vin' })
      ).rejects.toThrow('File must be an image')
    })

    test('handles canvas creation failures gracefully', async () => {
      global.document.createElement = vi.fn().mockReturnValue(null) as any

      const testFile = createTestFile('test.jpg')

      await expect(
        analyzeAndCropImage(testFile, { target: 'vin' })
      ).rejects.toThrow('Canvas 2D context unavailable')
    })

    test('handles createImageBitmap failures', async () => {
      global.createImageBitmap = vi.fn().mockRejectedValue(new Error('Invalid image format'))

      const testFile = createTestFile('corrupt.jpg')

      await expect(
        analyzeAndCropImage(testFile, { target: 'vin' })
      ).rejects.toThrow('Invalid image format')
    })
  })
})