import { expect, afterEach, beforeAll, afterAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { server } from './mocks/server'

// Extend Vitest's expect with Testing Library matchers
expect.extend(matchers)

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  observe() {
    return null
  }
  disconnect() {
    return null
  }
  unobserve() {
    return null
  }
}

// Mock URL.createObjectURL
global.URL.createObjectURL = vi.fn(() => 'mocked-url')
global.URL.revokeObjectURL = vi.fn()

// Mock File API
global.File = class File extends Blob {
  name: string
  lastModified: number

  constructor(chunks: BlobPart[], name: string, options?: FilePropertyBag) {
    super(chunks, options)
    this.name = name
    this.lastModified = options?.lastModified ?? Date.now()
  }
} as any

// Mock FileReader
global.FileReader = class FileReader {
  result: string | ArrayBuffer | null = null
  error: DOMException | null = null
  readyState: number = 0

  onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null = null
  onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null = null

  readAsDataURL(file: Blob) {
    setTimeout(() => {
      this.result = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD'
      this.readyState = 2
      this.onload?.(new ProgressEvent('load') as any)
    }, 0)
  }

  readAsArrayBuffer(file: Blob) {
    setTimeout(() => {
      this.result = new ArrayBuffer(8)
      this.readyState = 2
      this.onload?.(new ProgressEvent('load') as any)
    }, 0)
  }

  abort() {}
}

// Mock HTMLCanvasElement for image processing tests
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  drawImage: vi.fn(),
  getImageData: vi.fn().mockReturnValue({
    data: new Uint8ClampedArray(4),
    width: 1,
    height: 1
  }),
  putImageData: vi.fn(),
  createImageData: vi.fn(),
  canvas: {} as HTMLCanvasElement
})

HTMLCanvasElement.prototype.toBlob = vi.fn().mockImplementation((callback) => {
  callback(new Blob(['fake-canvas-data'], { type: 'image/jpeg' }))
})

// Mock createImageBitmap for image processing
global.createImageBitmap = vi.fn().mockResolvedValue({
  width: 1920,
  height: 1080,
  close: vi.fn()
} as ImageBitmap)

// Runs a cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup()
})

// Start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

// Close server after all tests
afterAll(() => server.close())

// Reset handlers after each test `important for test isolation`
afterEach(() => server.resetHandlers())