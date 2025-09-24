import { http, HttpResponse } from 'msw'
import type { OcrResult, ocrOdoResult } from '../../src/lib/api'
import { mockVinDatabase, mockOdometerDatabase } from './test-data'

// Get base URL from environment or use default
const BASE_URL = process.env.VITE_API_BASE_URL || 'http://localhost:3000'

export const handlers = [
  // VIN OCR endpoint
  http.post(`${BASE_URL}/ocr/vin`, async ({ request }) => {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 100))

    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return HttpResponse.json(
        { error: 'no_file', message: 'No image file provided' },
        { status: 400 }
      )
    }

    // Simulate file type validation
    if (!file.type.startsWith('image/')) {
      return HttpResponse.json(
        { error: 'invalid_file_type', message: 'Only images are supported' },
        { status: 400 }
      )
    }

    // Look up mock response based on filename
    const mockData = mockVinDatabase[file.name] || mockVinDatabase['default']

    const response: OcrResult = {
      ok: true,
      vin: mockData.vin,
      vinValid: mockData.vinValid,
      candidates: mockData.candidates,
      confidence: mockData.confidence,
      processingTime: Math.random() * 1000 + 500, // 500-1500ms
      textExtracted: true,
      totalBlocks: Math.floor(Math.random() * 50) + 10,
      lineCount: Math.floor(Math.random() * 20) + 5,
      fromCache: false
    }

    return HttpResponse.json(response)
  }),

  // Odometer OCR endpoint
  http.post(`${BASE_URL}/ocr/odometer`, async ({ request }) => {
    await new Promise(resolve => setTimeout(resolve, 80))

    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return HttpResponse.json(
        { error: 'no_file', message: 'No image file provided' },
        { status: 400 }
      )
    }

    const mockData = mockOdometerDatabase[file.name] || mockOdometerDatabase['default']

    const response: ocrOdoResult = {
      ok: true,
      km: mockData.km,
      unit: 'km',
      candidates: mockData.candidates,
      confidence: mockData.confidence,
      processingTime: Math.random() * 800 + 300, // 300-1100ms
      textExtracted: true,
      totalBlocks: Math.floor(Math.random() * 40) + 8,
      lineCount: Math.floor(Math.random() * 15) + 3,
      fromCache: false
    }

    return HttpResponse.json(response)
  }),

  // Photo upload endpoint
  http.post(`${BASE_URL}/intake/photos/upload`, async ({ request }) => {
    await new Promise(resolve => setTimeout(resolve, 200))

    const formData = await request.formData()
    const vin = formData.get('vin') as string
    const role = formData.get('role') as string
    const file = formData.get('file') as File

    if (!vin || !role || !file) {
      return HttpResponse.json(
        { error: 'vin_role_file_required' },
        { status: 400 }
      )
    }

    // Extract context metadata if present
    const context: Record<string, string> = {}
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('meta_')) {
        context[key.replace('meta_', '')] = value as string
      }
    }

    return HttpResponse.json({
      ok: true,
      record: {
        vin,
        role,
        object_key: `test-${Date.now()}.jpg`,
        url: `/uploads/test-${Date.now()}.jpg`,
        context
      }
    })
  }),

  // Checklist endpoint
  http.get(`${BASE_URL}/intake/checklist/:vin`, ({ params }) => {
    return HttpResponse.json({
      vin: params.vin,
      lot_id: 'TEST-LOT-001',
      checklist: {
        presentCount: 8,
        requiredCount: 12,
        missing: ['exterior_front_34', 'dash_odo', 'engine_bay', 'tyre_fl'],
        photosOk: false,
        hasDekra: true,
        hasOdo: false
      },
      ready: false
    })
  }),

  // Health check
  http.get(`${BASE_URL}/healthz`, () => {
    return HttpResponse.json({
      ok: true,
      dataDir: '/mock/data',
      hasPrivateKey: true,
      hasPublicKey: true,
      aws: {
        configured: false,
        region: 'eu-west-1',
        textractAvailable: false
      },
      cache: {
        keys: 0,
        stats: { keys: 0, hits: 0, misses: 0, ksize: 0, vsize: 0 }
      }
    })
  }),

  // OCR metrics
  http.get(`${BASE_URL}/metrics/ocr`, () => {
    return HttpResponse.json({
      totalRequests: 150,
      successfulRequests: 147,
      averageProcessingTime: 850,
      vinDetectionRate: 0.94,
      cacheHits: 23,
      successRate: '98.00%',
      cacheHitRate: '15.33%'
    })
  }),

  // Default fallback for unhandled requests
  http.all('*', ({ request }) => {
    console.warn(`Unhandled ${request.method} request to ${request.url}`)
    return HttpResponse.json(
      { error: 'not_found', message: `No handler for ${request.method} ${request.url}` },
      { status: 404 }
    )
  })
]