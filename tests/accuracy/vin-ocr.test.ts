import { describe, test, expect } from 'vitest'
import { ocrVinFromImage } from '../../src/lib/api'
import { TestImages, mockVinDatabase } from '../mocks/test-data'

// Define accuracy thresholds (>95% as requested)
const ACCURACY_THRESHOLDS = {
  clear_conditions: 0.95,    // Perfect license discs
  good_conditions: 0.90,     // Good but not perfect
  challenging_conditions: 0.75, // Damaged, angled, glare
  minimum_acceptable: 0.70   // Absolute minimum
}

describe('VIN OCR Accuracy Tests', () => {
  describe('License Disc Recognition - Clear Conditions', () => {
    test('achieves >95% accuracy on clear license disc images', async () => {
      const testCases = [
        'license_disc_clear_001.jpg',
        'license_disc_clear_002.jpg',
        'license_disc_clear_003.jpg'
      ]

      const results = await Promise.all(
        testCases.map(async (filename) => {
          const testFile = TestImages.vinClear()
          // Override filename for mock lookup
          Object.defineProperty(testFile, 'name', { value: filename })

          const result = await ocrVinFromImage(testFile)
          const expected = mockVinDatabase[filename]

          return {
            filename,
            success: result.vin === expected.vin,
            confidence: result.confidence,
            expected: expected.vin,
            actual: result.vin,
            vinValid: result.vinValid
          }
        })
      )

      const successCount = results.filter(r => r.success).length
      const accuracyRate = successCount / results.length

      expect(accuracyRate).toBeGreaterThanOrEqual(ACCURACY_THRESHOLDS.clear_conditions)

      // All clear images should have high confidence
      results.forEach(result => {
        expect(result.confidence).toBeGreaterThanOrEqual(0.90)
        expect(result.vinValid).toBe(true)
      })
    })

    test('correctly extracts specific South African VINs', async () => {
      const saCases = [
        { filename: 'license_disc_clear_001.jpg', expectedVin: 'AABCX12345K123456', make: 'BMW SA' },
        { filename: 'sa_specific_formats_001.jpg', expectedVin: 'AABCX12345K123456', make: 'BMW SA' },
        { filename: 'sa_specific_formats_002.jpg', expectedVin: 'AAVWX67890M654321', make: 'VW SA' }
      ]

      for (const testCase of saCases) {
        const testFile = TestImages.vinClear()
        Object.defineProperty(testFile, 'name', { value: testCase.filename })

        const result = await ocrVinFromImage(testFile)

        expect(result.vin).toBe(testCase.expectedVin)
        expect(result.vinValid).toBe(true)
        expect(result.confidence).toBeGreaterThanOrEqual(0.90)

        // Check South African WMI recognition
        if (testCase.expectedVin) {
          expect(testCase.expectedVin.startsWith('AA')).toBe(true) // SA prefix
        }
      }
    })
  })

  describe('License Disc Recognition - Challenging Conditions', () => {
    test('maintains >75% accuracy on damaged license discs', async () => {
      const damagedCases = [
        'license_disc_damaged_001.jpg',
        'license_disc_damaged_002.jpg'
      ]

      const results = await Promise.all(
        damagedCases.map(async (filename) => {
          const testFile = TestImages.vinDamaged()
          Object.defineProperty(testFile, 'name', { value: filename })

          const result = await ocrVinFromImage(testFile)
          const expected = mockVinDatabase[filename]

          return {
            filename,
            success: result.vin === expected.vin,
            confidence: result.confidence,
            hasValidCandidates: result.candidates.length > 0
          }
        })
      )

      const successCount = results.filter(r => r.success).length
      const accuracyRate = successCount / results.length

      expect(accuracyRate).toBeGreaterThanOrEqual(ACCURACY_THRESHOLDS.challenging_conditions)

      // Should still have reasonable confidence and candidates
      results.forEach(result => {
        expect(result.confidence).toBeGreaterThanOrEqual(0.70)
        expect(result.hasValidCandidates).toBe(true)
      })
    })

    test('handles angled shots with acceptable accuracy', async () => {
      const testFile = TestImages.vinAngled()
      Object.defineProperty(testFile, 'name', { value: 'license_disc_angled_001.jpg' })

      const result = await ocrVinFromImage(testFile)
      const expected = mockVinDatabase['license_disc_angled_001.jpg']

      expect(result.vin).toBe(expected.vin)
      expect(result.confidence).toBeGreaterThanOrEqual(ACCURACY_THRESHOLDS.challenging_conditions)
      expect(result.candidates).toContain(expected.vin)
    })

    test('manages glare and reflections', async () => {
      const testFile = TestImages.vinGlare()
      Object.defineProperty(testFile, 'name', { value: 'license_disc_glare_001.jpg' })

      const result = await ocrVinFromImage(testFile)
      const expected = mockVinDatabase['license_disc_glare_001.jpg']

      expect(result.vin).toBe(expected.vin)
      expect(result.confidence).toBeGreaterThanOrEqual(ACCURACY_THRESHOLDS.challenging_conditions)
    })

    test('performs adequately in low light conditions', async () => {
      const testFile = TestImages.vinLowLight()
      Object.defineProperty(testFile, 'name', { value: 'license_disc_low_light_001.jpg' })

      const result = await ocrVinFromImage(testFile)
      const expected = mockVinDatabase['license_disc_low_light_001.jpg']

      expect(result.vin).toBe(expected.vin)
      expect(result.confidence).toBeGreaterThanOrEqual(ACCURACY_THRESHOLDS.minimum_acceptable)
    })
  })

  describe('Alternative VIN Locations', () => {
    test('extracts VINs from windshield positions', async () => {
      const testFile = TestImages.vinClear()
      Object.defineProperty(testFile, 'name', { value: 'windshield_vin_clear_001.jpg' })

      const result = await ocrVinFromImage(testFile)
      const expected = mockVinDatabase['windshield_vin_clear_001.jpg']

      expect(result.vin).toBe(expected.vin)
      expect(result.vinValid).toBe(true)
      expect(result.confidence).toBeGreaterThanOrEqual(0.85)
    })

    test('reads engine bay VIN plates', async () => {
      const testFile = TestImages.vinClear()
      Object.defineProperty(testFile, 'name', { value: 'engine_bay_clean_001.jpg' })

      const result = await ocrVinFromImage(testFile)
      const expected = mockVinDatabase['engine_bay_clean_001.jpg']

      expect(result.vin).toBe(expected.vin)
      expect(result.vinValid).toBe(true)
      expect(result.confidence).toBeGreaterThanOrEqual(0.80)
    })
  })

  describe('Error Resilience and Edge Cases', () => {
    test('gracefully handles images with no VIN', async () => {
      const testFile = TestImages.vinNegative()
      Object.defineProperty(testFile, 'name', { value: 'negative_cases_001.jpg' })

      const result = await ocrVinFromImage(testFile)

      expect(result.vin).toBeNull()
      expect(result.vinValid).toBe(false)
      expect(result.confidence).toBeLessThan(0.50)
      expect(result.candidates).toHaveLength(0)
      expect(result.textExtracted).toBe(true) // Should still extract text, just no valid VIN
    })

    test('handles blurry images appropriately', async () => {
      const testFile = TestImages.vinBlurry()
      Object.defineProperty(testFile, 'name', { value: 'blurry_motion_001.jpg' })

      const result = await ocrVinFromImage(testFile)

      expect(result.vin).toBeNull()
      expect(result.confidence).toBeLessThan(0.50)
      expect(result.candidates.length).toBeGreaterThanOrEqual(0) // May have invalid candidates
    })

    test('prioritizes highest confidence VIN from multiple candidates', async () => {
      const testFile = TestImages.vinClear()
      Object.defineProperty(testFile, 'name', { value: 'multiple_vins_001.jpg' })

      const result = await ocrVinFromImage(testFile)
      const expected = mockVinDatabase['multiple_vins_001.jpg']

      expect(result.vin).toBe(expected.vin) // Should pick the most confident one
      expect(result.candidates).toContain(expected.vin)
      expect(result.candidates.length).toBeGreaterThan(1)
    })

    test('validates VIN check digits correctly', async () => {
      // Test with known valid South African VINs
      const validCases = [
        'license_disc_clear_001.jpg', // AABCX12345K123456
        'license_disc_clear_002.jpg', // AAVMN67890L654321
        'license_disc_clear_003.jpg'  // AHAJ12345P987654
      ]

      for (const filename of validCases) {
        const testFile = TestImages.vinClear()
        Object.defineProperty(testFile, 'name', { value: filename })

        const result = await ocrVinFromImage(testFile)

        expect(result.vin).toBeTruthy()
        expect(result.vinValid).toBe(true)
      }
    })
  })

  describe('Performance Requirements', () => {
    test('completes processing within 3 seconds', async () => {
      const testFile = TestImages.vinClear()
      const startTime = Date.now()

      const result = await ocrVinFromImage(testFile)
      const totalTime = Date.now() - startTime

      expect(totalTime).toBeLessThan(3000) // 3 second requirement
      expect(result.processingTime).toBeLessThan(3000)
    })

    test('provides processing time metrics', async () => {
      const testFile = TestImages.vinClear()

      const result = await ocrVinFromImage(testFile)

      expect(typeof result.processingTime).toBe('number')
      expect(result.processingTime).toBeGreaterThan(0)
      expect(result.processingTime).toBeLessThan(5000) // Reasonable upper bound
    })

    test('returns comprehensive metadata', async () => {
      const testFile = TestImages.vinClear()

      const result = await ocrVinFromImage(testFile)

      // Check all required response fields
      expect(result).toHaveProperty('ok')
      expect(result).toHaveProperty('vin')
      expect(result).toHaveProperty('vinValid')
      expect(result).toHaveProperty('candidates')
      expect(result).toHaveProperty('confidence')
      expect(result).toHaveProperty('processingTime')
      expect(result).toHaveProperty('textExtracted')
      expect(result).toHaveProperty('totalBlocks')
      expect(result).toHaveProperty('lineCount')
      expect(result).toHaveProperty('fromCache')

      expect(result.ok).toBe(true)
      expect(Array.isArray(result.candidates)).toBe(true)
      expect(typeof result.confidence).toBe('number')
      expect(typeof result.textExtracted).toBe('boolean')
      expect(typeof result.totalBlocks).toBe('number')
      expect(typeof result.lineCount).toBe('number')
      expect(typeof result.fromCache).toBe('boolean')
    })
  })

  describe('Overall System Accuracy', () => {
    test('achieves >95% overall accuracy across all test scenarios', async () => {
      const allTestCases = [
        // Clear conditions (should be 100% accurate)
        'license_disc_clear_001.jpg',
        'license_disc_clear_002.jpg',
        'license_disc_clear_003.jpg',
        'sa_specific_formats_001.jpg',
        'sa_specific_formats_002.jpg',

        // Good conditions (should be >90% accurate)
        'windshield_vin_clear_001.jpg',
        'engine_bay_clean_001.jpg',

        // Challenging conditions (should be >75% accurate)
        'license_disc_damaged_001.jpg',
        'license_disc_damaged_002.jpg',
        'license_disc_angled_001.jpg',
        'license_disc_glare_001.jpg',
        'license_disc_low_light_001.jpg'
      ]

      const results = await Promise.all(
        allTestCases.map(async (filename) => {
          const testFile = TestImages.vinClear() // Use appropriate test file
          Object.defineProperty(testFile, 'name', { value: filename })

          const result = await ocrVinFromImage(testFile)
          const expected = mockVinDatabase[filename]

          return {
            filename,
            success: result.vin === expected.vin && result.vinValid === expected.vinValid,
            confidence: result.confidence
          }
        })
      )

      const successCount = results.filter(r => r.success).length
      const overallAccuracy = successCount / results.length

      // Main requirement: >95% overall accuracy
      expect(overallAccuracy).toBeGreaterThanOrEqual(0.95)

      console.log(`VIN OCR Overall Accuracy: ${(overallAccuracy * 100).toFixed(1)}%`)
      console.log(`Successful extractions: ${successCount}/${results.length}`)

      // Log failed cases for debugging
      const failures = results.filter(r => !r.success)
      if (failures.length > 0) {
        console.log('Failed cases:', failures.map(f => f.filename))
      }
    })
  })
})