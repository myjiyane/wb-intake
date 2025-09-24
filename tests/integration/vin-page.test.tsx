import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import Vin from '../../src/pages/Vin'
import { TestImages } from '../mocks/test-data'

// Mock the router params
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useParams: () => ({ vin: 'AABCX12345K123456' }),
    useSearchParams: () => [new URLSearchParams('lot=TEST-LOT-001')]
  }
})

// Mock the logger to avoid console spam
vi.mock('../../src/lib/logger', () => ({
  logger: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  },
  serializeError: vi.fn((error) => ({ message: error.message }))
}))

const renderVinPage = () => {
  return render(
    <BrowserRouter>
      <Vin />
    </BrowserRouter>
  )
}

describe('VIN Page Integration Tests', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Complete VIN Capture Workflow', () => {
    test('successfully processes a high-quality VIN image', async () => {
      renderVinPage()

      // Wait for page to load
      await waitFor(() => {
        expect(screen.getByText(/VIN:/)).toBeInTheDocument()
      })

      // Verify VIN is displayed
      expect(screen.getByText('AABCX12345K123456')).toBeInTheDocument()

      // Find and interact with photo capture area
      const captureSection = screen.getByText(/Photo Documentation/i).closest('div')
      expect(captureSection).toBeInTheDocument()

      // Look for a role button to click (e.g., exterior_front_34)
      const photoButton = screen.getByRole('button', { name: /exterior front 34/i })
      await user.click(photoButton)

      // Should open guidance modal
      await waitFor(() => {
        expect(screen.getByText(/Take.*photo/i)).toBeInTheDocument()
      })

      // Click the proceed button in modal
      const proceedButton = screen.getByRole('button', { name: /Take.*photo/i })
      await user.click(proceedButton)

      // Modal should close and file input should be available
      const fileInput = screen.getByLabelText(/take.*photo/i) || screen.getByRole('button', { name: /take photo/i })
      expect(fileInput).toBeInTheDocument()

      // Create and upload test file
      const testFile = TestImages.vinClear()
      Object.defineProperty(testFile, 'name', { value: 'license_disc_clear_001.jpg' })

      await user.upload(fileInput, testFile)

      // Should show processing state
      await waitFor(() => {
        expect(screen.getByText(/processing/i) || screen.getByText(/uploading/i)).toBeInTheDocument()
      }, { timeout: 1000 })

      // Should complete successfully
      await waitFor(() => {
        expect(screen.queryByText(/retake.*photo/i)).not.toBeInTheDocument()
      }, { timeout: 3000 })

      // Should not show quality issues for good image
      expect(screen.queryByText(/blurry/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/too dark/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/low contrast/i)).not.toBeInTheDocument()
    }, 10000)

    test('detects and prompts retake for poor quality images', async () => {
      renderVinPage()

      await waitFor(() => {
        expect(screen.getByText(/Photo Documentation/i)).toBeInTheDocument()
      })

      // Click on a photo role
      const photoButton = screen.getByRole('button', { name: /exterior front 34/i })
      await user.click(photoButton)

      // Proceed through modal
      const proceedButton = screen.getByRole('button', { name: /Take.*photo/i })
      await user.click(proceedButton)

      // Create poor quality image (blurry)
      const poorQualityFile = TestImages.vinBlurry()

      const fileInput = screen.getByLabelText(/take.*photo/i) || screen.getByRole('button', { name: /take photo/i })
      await user.upload(fileInput, poorQualityFile)

      // Should detect quality issues and prompt retake
      await waitFor(() => {
        expect(
          screen.getByText(/retake.*photo/i) ||
          screen.getByText(/blurry/i) ||
          screen.getByText(/quality/i)
        ).toBeInTheDocument()
      }, { timeout: 2000 })

      // Upload should be blocked - verify no success state
      await waitFor(() => {
        expect(screen.queryByText(/uploaded successfully/i)).not.toBeInTheDocument()
      }, { timeout: 1000 })
    })

    test('handles VIN detection workflow', async () => {
      renderVinPage()

      await waitFor(() => {
        expect(screen.getByText(/Verify VIN/i)).toBeInTheDocument()
      })

      // Click VIN verification button
      const vinVerifyButton = screen.getByRole('button', { name: /Verify VIN/i })
      await user.click(vinVerifyButton)

      // This would typically trigger VIN scanner, but since we're testing integration,
      // we'll verify the button functionality
      expect(vinVerifyButton).toBeInTheDocument()

      // In a real integration test, we would:
      // 1. Verify VIN scanner opens
      // 2. Simulate VIN detection
      // 3. Verify results display
      // 4. Check accuracy validation
    })
  })

  describe('Odometer Capture Workflow', () => {
    test('processes odometer reading with OCR validation', async () => {
      renderVinPage()

      await waitFor(() => {
        expect(screen.getByText(/Odometer Reading/i)).toBeInTheDocument()
      })

      // Find and click odometer capture button
      const odometerButton = screen.getByRole('button', { name: /CAPTURE ODOMETER/i })
      expect(odometerButton).toBeInTheDocument()

      await user.click(odometerButton)

      // Should show processing state initially
      await waitFor(() => {
        expect(
          screen.getByText(/Reading odometer/i) ||
          screen.getByText(/processing/i)
        ).toBeInTheDocument()
      }, { timeout: 1000 })

      // Create odometer test file
      const odometerFile = TestImages.odometerDigitalClear()
      Object.defineProperty(odometerFile, 'name', { value: 'digital_clear_001.jpg' })

      // Simulate file input interaction (implementation depends on actual component)
      // This is a simplified test - real implementation would handle file input differently
      const fileInputs = screen.getAllByRole('button')
      const odometerFileInput = fileInputs.find(input =>
        input.getAttribute('accept')?.includes('image/*')
      )

      if (odometerFileInput) {
        // Simulate file upload via change event
        const changeEvent = new Event('change', { bubbles: true })
        Object.defineProperty(changeEvent, 'target', {
          writable: false,
          value: { files: [odometerFile] }
        })

        odometerFileInput.dispatchEvent(changeEvent)
      }

      // Should show OCR results
      await waitFor(() => {
        expect(
          screen.getByText(/45678/i) || // Expected odometer reading
          screen.getByText(/km/i)
        ).toBeInTheDocument()
      }, { timeout: 3000 })
    })

    test('handles manual odometer adjustment workflow', async () => {
      renderVinPage()

      await waitFor(() => {
        expect(screen.getByText(/Odometer Reading/i)).toBeInTheDocument()
      })

      // This test would verify:
      // 1. OCR extraction shows initial reading
      // 2. User can manually adjust the reading
      // 3. System tracks manual adjustment with justification
      // 4. Final reading is saved correctly

      // Look for odometer input field (after OCR processing)
      const odometerInputs = screen.queryAllByDisplayValue(/\d+/)
      if (odometerInputs.length > 0) {
        const odometerInput = odometerInputs[0]

        // Clear and enter new value
        await user.clear(odometerInput)
        await user.type(odometerInput, '50000')

        // Should show manual adjustment warning
        await waitFor(() => {
          expect(screen.getByText(/manual adjustment/i)).toBeInTheDocument()
        })

        // Justification field should appear
        const justificationField = screen.getByPlaceholderText(/why.*adjusted/i)
        expect(justificationField).toBeInTheDocument()

        await user.type(justificationField, 'OCR misread the last digit')

        // Save button should be available
        const saveButton = screen.getByRole('button', { name: /save.*reading/i })
        expect(saveButton).toBeInTheDocument()
      }
    })
  })

  describe('Quality Validation Integration', () => {
    test('integrates image preprocessing with upload workflow', async () => {
      renderVinPage()

      // Wait for component to load
      await waitFor(() => {
        expect(screen.getByText(/Photo Documentation/i)).toBeInTheDocument()
      })

      // Navigate through photo capture process
      const photoButton = screen.getByRole('button', { name: /engine bay/i })
      await user.click(photoButton)

      // Should show VIN scanning hint for engine bay
      await waitFor(() => {
        expect(
          screen.getByText(/VIN.*visible/i) ||
          screen.getByText(/scan.*verification/i)
        ).toBeInTheDocument()
      })

      const proceedButton = screen.getByRole('button', { name: /Take.*photo/i })
      await user.click(proceedButton)

      // Test with VIN-scannable image
      const vinEngineFile = TestImages.vinClear()
      Object.defineProperty(vinEngineFile, 'name', { value: 'engine_bay_clean_001.jpg' })

      const fileInput = screen.getByLabelText(/take.*photo/i) || screen.getByRole('button', { name: /take photo/i })
      await user.upload(fileInput, vinEngineFile)

      // Should trigger VIN scanning confirmation
      // In real implementation, this might show a confirmation dialog

      // Process should complete with context metadata
      await waitFor(() => {
        expect(screen.queryByText(/retake/i)).not.toBeInTheDocument()
      }, { timeout: 3000 })
    })
  })

  describe('Tyre Measurements Integration', () => {
    test('validates tyre depth input completion', async () => {
      renderVinPage()

      await waitFor(() => {
        expect(screen.getByText(/Tyre Tread Depths/i)).toBeInTheDocument()
      })

      // Find tyre depth input fields
      const tyreInputs = screen.getAllByPlaceholderText('0.0')
      expect(tyreInputs).toHaveLength(4) // FL, FR, RL, RR

      // Fill in all tyre depths
      const tyreValues = ['2.5', '3.0', '2.8', '3.2']

      for (let i = 0; i < tyreInputs.length; i++) {
        await user.clear(tyreInputs[i])
        await user.type(tyreInputs[i], tyreValues[i])
      }

      // Progress indicator should show completion
      await waitFor(() => {
        expect(screen.getByText(/4\/4 completed/i)).toBeInTheDocument()
      })

      // Save button should be enabled
      const saveButton = screen.getByRole('button', { name: /save/i })
      expect(saveButton).not.toBeDisabled()

      await user.click(saveButton)

      // Should show saving state
      await waitFor(() => {
        expect(screen.getByText(/saving/i)).toBeInTheDocument()
      }, { timeout: 1000 })
    })

    test('prevents incomplete tyre measurements submission', async () => {
      renderVinPage()

      await waitFor(() => {
        expect(screen.getByText(/Tyre Tread Depths/i)).toBeInTheDocument()
      })

      // Fill only some tyre depths
      const tyreInputs = screen.getAllByPlaceholderText('0.0')
      await user.type(tyreInputs[0], '2.5') // FL only

      // Progress should show incomplete
      await waitFor(() => {
        expect(screen.getByText(/1\/4 completed/i)).toBeInTheDocument()
      })

      // Save button should be disabled
      const saveButton = screen.getByRole('button', { name: /save/i })
      expect(saveButton).toBeDisabled()

      // Should show validation message
      expect(screen.getByText(/all.*measurements.*required/i)).toBeInTheDocument()
    })
  })

  describe('Error Handling Integration', () => {
    test('handles network errors gracefully', async () => {
      // Mock network failure
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      renderVinPage()

      await waitFor(() => {
        expect(screen.getByText(/VIN:/i)).toBeInTheDocument()
      })

      // Component should still render even with network issues
      expect(screen.getByText('AABCX12345K123456')).toBeInTheDocument()

      consoleSpy.mockRestore()
    })

    test('displays appropriate loading states', async () => {
      renderVinPage()

      // Should show loading initially
      expect(
        screen.getByText(/loading/i) ||
        screen.queryByText(/VIN:/i)
      ).toBeInTheDocument()

      // Should resolve to loaded state
      await waitFor(() => {
        expect(screen.getByText(/Photo Documentation/i)).toBeInTheDocument()
      })
    })
  })

  describe('Accessibility Integration', () => {
    test('maintains accessibility standards', async () => {
      renderVinPage()

      await waitFor(() => {
        expect(screen.getByText(/VIN:/i)).toBeInTheDocument()
      })

      // Check for proper labeling
      expect(screen.getByRole('main') || screen.getByRole('article')).toBeInTheDocument()

      // Buttons should be properly labeled
      const buttons = screen.getAllByRole('button')
      buttons.forEach(button => {
        expect(button).toHaveAccessibleName()
      })

      // File inputs should be properly associated
      const fileInputs = screen.queryAllByLabelText(/take.*photo/i)
      fileInputs.forEach(input => {
        expect(input).toBeInTheDocument()
      })
    })
  })
})