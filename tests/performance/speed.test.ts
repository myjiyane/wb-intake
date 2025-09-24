import { describe, test, expect, vi } from 'vitest'
import { analyzeAndCropImage } from '../../src/lib/image-utils'
import { ocrVinFromImage, ocrOdoFromImage } from '../../src/lib/api'
import { createTestFile, TestImages } from '../mocks/test-data'

// Performance thresholds based on requirements
const PERFORMANCE_THRESHOLDS = {
  imageProcessing: 200,      // <200ms for image processing
  vinOcr: 3000,             // <3000ms for VIN OCR end-to-end
  odometerOcr: 2500,        // <2500ms for odometer OCR end-to-end
  qualityValidation: 50,     // <50ms for quality validation
  memoryLimitMB: 50          // <50MB memory increase
}

describe('Performance Benchmarks', () => {
  describe('Image Processing Speed', () => {
    test('crops VIN images within 200ms', async () => {
      const testFile = createTestFile('performance-test-vin.jpg', 'x'.repeat(1024 * 1024)) // 1MB test file

      const startTime = performance.now()
      const result = await analyzeAndCropImage(testFile, { target: 'vin' })
      const duration = performance.now() - startTime

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.imageProcessing)
      expect(result.analysis).toBeDefined()
      expect(result.processedFile).toBeInstanceOf(File)

      console.log(`VIN image processing: ${duration.toFixed(1)}ms`)
    })

    test('crops odometer images within 200ms', async () => {
      const testFile = createTestFile('performance-test-odometer.jpg', 'x'.repeat(1024 * 1024)) // 1MB test file

      const startTime = performance.now()
      const result = await analyzeAndCropImage(testFile, { target: 'odometer' })
      const duration = performance.now() - startTime

      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.imageProcessing)
      expect(result.analysis).toBeDefined()

      console.log(`Odometer image processing: ${duration.toFixed(1)}ms`)
    })

    test('handles large images efficiently', async () => {
      // Simulate 5MB image
      const largeTestFile = createTestFile('large-test.jpg', 'x'.repeat(5 * 1024 * 1024))

      const startTime = performance.now()
      const result = await analyzeAndCropImage(largeTestFile, { target: 'vin' })
      const duration = performance.now() - startTime

      // Allow more time for larger files but should still be reasonable
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.imageProcessing * 2) // 400ms max
      expect(result.processedFile.size).toBeLessThan(largeTestFile.size) // Should be compressed

      console.log(`Large image processing: ${duration.toFixed(1)}ms`)
    })

    test('quality validation completes quickly', async () => {
      const testFile = createTestFile('quality-test.jpg')

      const startTime = performance.now()
      const result = await analyzeAndCropImage(testFile, { target: 'vin' })
      const validationTime = performance.now() - startTime

      // Quality validation should be very fast
      expect(validationTime).toBeLessThan(PERFORMANCE_THRESHOLDS.qualityValidation)
      expect(result.analysis.shouldRetake).toBeDefined()
      expect(Array.isArray(result.analysis.issues)).toBe(true)

      console.log(`Quality validation: ${validationTime.toFixed(1)}ms`)
    })
  })

  describe('OCR Processing Speed', () => {
    test('VIN OCR completes within 3 seconds', async () => {
      const testFile = TestImages.vinClear()

      const startTime = performance.now()
      const result = await ocrVinFromImage(testFile)
      const totalTime = performance.now() - startTime

      expect(totalTime).toBeLessThan(PERFORMANCE_THRESHOLDS.vinOcr)
      expect(result.processingTime).toBeLessThan(PERFORMANCE_THRESHOLDS.vinOcr)
      expect(result.ok).toBe(true)

      console.log(`VIN OCR total time: ${totalTime.toFixed(1)}ms (reported: ${result.processingTime}ms)`)
    })

    test('odometer OCR completes within 2.5 seconds', async () => {
      const testFile = TestImages.odometerDigitalClear()

      const startTime = performance.now()
      const result = await ocrOdoFromImage(testFile)
      const totalTime = performance.now() - startTime

      expect(totalTime).toBeLessThan(PERFORMANCE_THRESHOLDS.odometerOcr)
      expect(result.processingTime).toBeLessThan(PERFORMANCE_THRESHOLDS.odometerOcr)
      expect(result.ok).toBe(true)

      console.log(`Odometer OCR total time: ${totalTime.toFixed(1)}ms (reported: ${result.processingTime}ms)`)
    })

    test('handles multiple concurrent OCR requests efficiently', async () => {
      const concurrentRequests = 3
      const testFiles = [
        TestImages.vinClear(),
        TestImages.odometerDigitalClear(),
        TestImages.vinClear()
      ]

      const startTime = performance.now()

      const promises = testFiles.map((file, index) => {
        return index % 2 === 0
          ? ocrVinFromImage(file)
          : ocrOdoFromImage(file)
      })

      const results = await Promise.all(promises)
      const totalTime = performance.now() - startTime

      // Concurrent requests should not take much longer than single request
      expect(totalTime).toBeLessThan(PERFORMANCE_THRESHOLDS.vinOcr * 1.5) // 4.5 seconds max

      results.forEach(result => {
        expect(result.ok).toBe(true)
      })

      console.log(`${concurrentRequests} concurrent OCR requests: ${totalTime.toFixed(1)}ms`)
    })
  })

  describe('Memory Usage', () => {
    test('processes multiple images without memory leaks', async () => {
      // Skip memory test in non-node environments
      if (typeof process === 'undefined') {
        console.log('Skipping memory test - not in Node.js environment')
        return
      }

      const initialMemory = process.memoryUsage().heapUsed

      // Process multiple images in sequence
      for (let i = 0; i < 10; i++) {
        const testFile = createTestFile(`memory-test-${i}.jpg`, 'x'.repeat(1024 * 1024))
        await analyzeAndCropImage(testFile, { target: 'vin' })

        // Force garbage collection if available
        if (global.gc) {
          global.gc()
        }
      }

      const finalMemory = process.memoryUsage().heapUsed
      const memoryIncreaseMB = (finalMemory - initialMemory) / (1024 * 1024)

      expect(memoryIncreaseMB).toBeLessThan(PERFORMANCE_THRESHOLDS.memoryLimitMB)

      console.log(`Memory increase after 10 image processes: ${memoryIncreaseMB.toFixed(1)}MB`)
    })

    test('properly cleans up canvas resources', async () => {
      // Track canvas creation calls
      const originalCreateElement = global.document.createElement
      let canvasCount = 0

      global.document.createElement = vi.fn().mockImplementation((tagName: string) => {
        if (tagName === 'canvas') {
          canvasCount++
        }
        return originalCreateElement.call(document, tagName)
      }) as any

      // Process several images
      for (let i = 0; i < 5; i++) {
        const testFile = createTestFile(`cleanup-test-${i}.jpg`)
        await analyzeAndCropImage(testFile, { target: 'vin' })
      }

      // We expect some canvas elements to be created, but not an excessive amount
      expect(canvasCount).toBeGreaterThan(0)
      expect(canvasCount).toBeLessThan(50) // Reasonable upper bound

      console.log(`Canvas elements created: ${canvasCount}`)

      // Restore original function
      global.document.createElement = originalCreateElement
    })
  })

  describe('Baseline Performance Metrics', () => {
    test('establishes baseline performance metrics', async () => {
      const metrics = {
        vinProcessing: [],
        odometerProcessing: [],
        vinOcr: [],
        odometerOcr: []
      } as Record<string, number[]>

      // Run multiple iterations to get average performance
      const iterations = 5

      for (let i = 0; i < iterations; i++) {
        // VIN image processing
        const vinFile = TestImages.vinClear()
        let startTime = performance.now()
        await analyzeAndCropImage(vinFile, { target: 'vin' })
        metrics.vinProcessing.push(performance.now() - startTime)

        // Odometer image processing
        const odoFile = TestImages.odometerDigitalClear()
        startTime = performance.now()
        await analyzeAndCropImage(odoFile, { target: 'odometer' })
        metrics.odometerProcessing.push(performance.now() - startTime)

        // VIN OCR
        startTime = performance.now()
        const vinResult = await ocrVinFromImage(TestImages.vinClear())
        const vinTotalTime = performance.now() - startTime
        metrics.vinOcr.push(vinTotalTime)

        // Odometer OCR
        startTime = performance.now()
        const odoResult = await ocrOdoFromImage(TestImages.odometerDigitalClear())
        const odoTotalTime = performance.now() - startTime
        metrics.odometerOcr.push(odoTotalTime)

        // Verify results are valid
        expect(vinResult.ok).toBe(true)
        expect(odoResult.ok).toBe(true)
      }

      // Calculate averages
      const averages = Object.entries(metrics).reduce((acc, [key, values]) => {
        acc[key] = values.reduce((sum, val) => sum + val, 0) / values.length
        return acc
      }, {} as Record<string, number>)

      // Log baseline metrics
      console.log('Baseline Performance Metrics:')
      console.log(`VIN Image Processing: ${averages.vinProcessing.toFixed(1)}ms avg`)
      console.log(`Odometer Image Processing: ${averages.odometerProcessing.toFixed(1)}ms avg`)
      console.log(`VIN OCR End-to-End: ${averages.vinOcr.toFixed(1)}ms avg`)
      console.log(`Odometer OCR End-to-End: ${averages.odometerOcr.toFixed(1)}ms avg`)

      // Store baselines for future comparison
      expect(averages.vinProcessing).toBeLessThan(PERFORMANCE_THRESHOLDS.imageProcessing)
      expect(averages.odometerProcessing).toBeLessThan(PERFORMANCE_THRESHOLDS.imageProcessing)
      expect(averages.vinOcr).toBeLessThan(PERFORMANCE_THRESHOLDS.vinOcr)
      expect(averages.odometerOcr).toBeLessThan(PERFORMANCE_THRESHOLDS.odometerOcr)

      // Performance should be consistent (low variance)
      Object.entries(metrics).forEach(([key, values]) => {
        const avg = averages[key]
        const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length
        const stdDev = Math.sqrt(variance)
        const coefficientOfVariation = stdDev / avg

        // Standard deviation should be less than 30% of mean (reasonable consistency)
        expect(coefficientOfVariation).toBeLessThan(0.3)

        console.log(`${key} consistency (CV): ${(coefficientOfVariation * 100).toFixed(1)}%`)
      })
    })

    test('tracks processing time components', async () => {
      const testFile = TestImages.vinClear()

      const result = await ocrVinFromImage(testFile)

      // Verify we get processing time breakdown
      expect(result.processingTime).toBeGreaterThan(0)
      expect(typeof result.processingTime).toBe('number')

      // Processing time should be reasonable
      expect(result.processingTime).toBeLessThan(PERFORMANCE_THRESHOLDS.vinOcr)
      expect(result.processingTime).toBeGreaterThan(50) // Should take at least some time

      console.log(`OCR processing time breakdown: ${result.processingTime}ms total`)
    })
  })

  describe('Performance Regression Detection', () => {
    test('detects significant performance regressions', async () => {
      // This test would fail if performance degrades significantly
      const testFile = TestImages.vinClear()

      const measurements: number[] = []
      const iterations = 3

      for (let i = 0; i < iterations; i++) {
        const startTime = performance.now()
        const result = await ocrVinFromImage(testFile)
        const duration = performance.now() - startTime

        expect(result.ok).toBe(true)
        measurements.push(duration)
      }

      const avgTime = measurements.reduce((sum, time) => sum + time, 0) / measurements.length
      const maxTime = Math.max(...measurements)

      // Average should be well within threshold
      expect(avgTime).toBeLessThan(PERFORMANCE_THRESHOLDS.vinOcr * 0.8) // 80% of threshold

      // No single measurement should exceed threshold
      expect(maxTime).toBeLessThan(PERFORMANCE_THRESHOLDS.vinOcr)

      console.log(`Performance regression check - Avg: ${avgTime.toFixed(1)}ms, Max: ${maxTime.toFixed(1)}ms`)

      // Log warning if performance is getting close to threshold
      if (avgTime > PERFORMANCE_THRESHOLDS.vinOcr * 0.7) {
        console.warn(`⚠️  Performance approaching threshold: ${avgTime.toFixed(1)}ms (threshold: ${PERFORMANCE_THRESHOLDS.vinOcr}ms)`)
      }
    })
  })
})