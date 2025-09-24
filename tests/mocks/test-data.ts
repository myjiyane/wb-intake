// Mock database for VIN OCR test responses
export const mockVinDatabase: Record<string, {
  vin: string | null
  vinValid: boolean
  candidates: string[]
  confidence: number
}> = {
  // Perfect license disc images
  'license_disc_clear_001.jpg': {
    vin: 'AABCX12345K123456',
    vinValid: true,
    candidates: ['AABCX12345K123456'],
    confidence: 0.98
  },
  'license_disc_clear_002.jpg': {
    vin: 'AAVMN67890L654321',
    vinValid: true,
    candidates: ['AAVMN67890L654321'],
    confidence: 0.96
  },
  'license_disc_clear_003.jpg': {
    vin: 'AHAJ12345P987654',
    vinValid: true,
    candidates: ['AHAJ12345P987654'],
    confidence: 0.97
  },

  // Damaged license disc images
  'license_disc_damaged_001.jpg': {
    vin: 'AABCX12345K123456',
    vinValid: true,
    candidates: ['AABCX12345K123456', 'AABCX12345K123450'],
    confidence: 0.82
  },
  'license_disc_damaged_002.jpg': {
    vin: 'AAVMN67890L654321',
    vinValid: true,
    candidates: ['AAVMN67890L654321', 'AAVMN67B90L654321'],
    confidence: 0.78
  },

  // Angled shots
  'license_disc_angled_001.jpg': {
    vin: 'AABCX12345K123456',
    vinValid: true,
    candidates: ['AABCX12345K123456', 'AABCK12345K123456'],
    confidence: 0.85
  },

  // Glare/reflection cases
  'license_disc_glare_001.jpg': {
    vin: 'AAVMN67890L654321',
    vinValid: true,
    candidates: ['AAVMN67890L654321', 'AAVMN67890L654B21'],
    confidence: 0.79
  },

  // Low light conditions
  'license_disc_low_light_001.jpg': {
    vin: 'AHAJ12345P987654',
    vinValid: true,
    candidates: ['AHAJ12345P987654', 'AHAJ12345P987B54'],
    confidence: 0.76
  },

  // Windshield VIN cases
  'windshield_vin_clear_001.jpg': {
    vin: 'WBAVB13506PT12345',
    vinValid: true,
    candidates: ['WBAVB13506PT12345'],
    confidence: 0.94
  },

  // Engine bay VIN
  'engine_bay_clean_001.jpg': {
    vin: 'WDDGF8AB9DR123456',
    vinValid: true,
    candidates: ['WDDGF8AB9DR123456'],
    confidence: 0.91
  },

  // South African specific formats
  'sa_specific_formats_001.jpg': {
    vin: 'AABCX12345K123456', // BMW SA
    vinValid: true,
    candidates: ['AABCX12345K123456'],
    confidence: 0.95
  },
  'sa_specific_formats_002.jpg': {
    vin: 'AAVWX67890M654321', // VW SA
    vinValid: true,
    candidates: ['AAVWX67890M654321'],
    confidence: 0.93
  },

  // Partial/obscured cases
  'partial_visible_001.jpg': {
    vin: null,
    vinValid: false,
    candidates: ['AABCX12345K12345', 'AABCX12345K1234'],
    confidence: 0.42
  },

  // Blurry images
  'blurry_motion_001.jpg': {
    vin: null,
    vinValid: false,
    candidates: ['AABCX12345K123ABC', 'AABCX1234BK123456'],
    confidence: 0.35
  },

  // Multiple VINs in frame
  'multiple_vins_001.jpg': {
    vin: 'AABCX12345K123456', // Should pick the clearest/most confident
    vinValid: true,
    candidates: ['AABCX12345K123456', 'WDDGF8AB9DR987654'],
    confidence: 0.88
  },

  // Negative cases (no VIN)
  'negative_cases_001.jpg': {
    vin: null,
    vinValid: false,
    candidates: [],
    confidence: 0.0
  },

  // Default fallback
  'default': {
    vin: 'AABCX12345K123456',
    vinValid: true,
    candidates: ['AABCX12345K123456'],
    confidence: 0.90
  }
}

// Mock database for odometer OCR test responses
export const mockOdometerDatabase: Record<string, {
  km: number | null
  candidates: { value: number; score: number }[]
  confidence: number
}> = {
  // Clear digital displays
  'digital_clear_001.jpg': {
    km: 45678,
    candidates: [
      { value: 45678, score: 0.95 },
      { value: 45679, score: 0.12 }
    ],
    confidence: 0.98
  },
  'digital_clear_002.jpg': {
    km: 123456,
    candidates: [
      { value: 123456, score: 0.97 },
      { value: 123455, score: 0.08 }
    ],
    confidence: 0.97
  },
  'digital_clear_003.jpg': {
    km: 7890,
    candidates: [
      { value: 7890, score: 0.94 },
      { value: 7896, score: 0.15 }
    ],
    confidence: 0.96
  },

  // Digital with glare
  'digital_glare_001.jpg': {
    km: 45678,
    candidates: [
      { value: 45678, score: 0.78 },
      { value: 45670, score: 0.22 },
      { value: 45600, score: 0.18 }
    ],
    confidence: 0.82
  },

  // Analog displays
  'analog_clear_001.jpg': {
    km: 234567,
    candidates: [
      { value: 234567, score: 0.85 },
      { value: 234560, score: 0.28 },
      { value: 234500, score: 0.15 }
    ],
    confidence: 0.88
  },
  'analog_clear_002.jpg': {
    km: 89012,
    candidates: [
      { value: 89012, score: 0.82 },
      { value: 89010, score: 0.31 }
    ],
    confidence: 0.85
  },

  // Partially visible analog
  'analog_partial_001.jpg': {
    km: 156000, // Rounded to nearest thousand due to partial visibility
    candidates: [
      { value: 156000, score: 0.65 },
      { value: 155000, score: 0.35 },
      { value: 157000, score: 0.22 }
    ],
    confidence: 0.71
  },

  // High mileage cases
  'high_mileage_001.jpg': {
    km: 567890,
    candidates: [
      { value: 567890, score: 0.91 },
      { value: 567800, score: 0.18 }
    ],
    confidence: 0.93
  },
  'high_mileage_002.jpg': {
    km: 789123,
    candidates: [
      { value: 789123, score: 0.89 }
    ],
    confidence: 0.92
  },

  // Low mileage
  'low_mileage_001.jpg': {
    km: 1234,
    candidates: [
      { value: 1234, score: 0.96 }
    ],
    confidence: 0.97
  },
  'low_mileage_002.jpg': {
    km: 5678,
    candidates: [
      { value: 5678, score: 0.94 },
      { value: 5670, score: 0.12 }
    ],
    confidence: 0.95
  },

  // Dashboard context (full dashboard visible)
  'dashboard_context_001.jpg': {
    km: 98765,
    candidates: [
      { value: 98765, score: 0.87 },
      { value: 98760, score: 0.25 }
    ],
    confidence: 0.89
  },

  // Close-up shots
  'close_up_001.jpg': {
    km: 34567,
    candidates: [
      { value: 34567, score: 0.93 }
    ],
    confidence: 0.96
  },

  // Angled shots
  'angled_shots_001.jpg': {
    km: 67890,
    candidates: [
      { value: 67890, score: 0.79 },
      { value: 67800, score: 0.28 },
      { value: 67000, score: 0.15 }
    ],
    confidence: 0.81
  },

  // Poor lighting
  'poor_lighting_001.jpg': {
    km: 45123,
    candidates: [
      { value: 45123, score: 0.72 },
      { value: 45100, score: 0.34 },
      { value: 45120, score: 0.22 }
    ],
    confidence: 0.76
  },

  // Cracked display
  'cracked_display_001.jpg': {
    km: 78901,
    candidates: [
      { value: 78901, score: 0.78 },
      { value: 78900, score: 0.42 },
      { value: 70901, score: 0.25 }
    ],
    confidence: 0.78
  },

  // Decimal readings
  'decimal_readings_001.jpg': {
    km: 12345, // Should extract whole number part
    candidates: [
      { value: 12345, score: 0.91 }
    ],
    confidence: 0.93
  },

  // Negative cases (no readable odometer)
  'negative_cases_001.jpg': {
    km: null,
    candidates: [],
    confidence: 0.0
  },

  // Default fallback
  'default': {
    km: 50000,
    candidates: [
      { value: 50000, score: 0.90 }
    ],
    confidence: 0.92
  }
}

// Helper function to create test files with specific names
export function createTestFile(filename: string, content?: string): File {
  // Create realistic file content (minimum 2KB for JPEG validation)
  const defaultContent = content || 'fake-image-jpeg-content'.repeat(100) // ~2.3KB
  const blob = new Blob([defaultContent], { type: 'image/jpeg' })
  return new File([blob], filename, { type: 'image/jpeg', lastModified: Date.now() })
}

// Helper to create test images for different scenarios
export const TestImages = {
  vinClear: () => createTestFile('license_disc_clear_001.jpg'),
  vinDamaged: () => createTestFile('license_disc_damaged_001.jpg'),
  vinAngled: () => createTestFile('license_disc_angled_001.jpg'),
  vinGlare: () => createTestFile('license_disc_glare_001.jpg'),
  vinLowLight: () => createTestFile('license_disc_low_light_001.jpg'),
  vinBlurry: () => createTestFile('blurry_motion_001.jpg'),
  vinNegative: () => createTestFile('negative_cases_001.jpg'),

  odometerDigitalClear: () => createTestFile('digital_clear_001.jpg'),
  odometerDigitalGlare: () => createTestFile('digital_glare_001.jpg'),
  odometerAnalogClear: () => createTestFile('analog_clear_001.jpg'),
  odometerAnalogPartial: () => createTestFile('analog_partial_001.jpg'),
  odometerHighMileage: () => createTestFile('high_mileage_001.jpg'),
  odometerLowMileage: () => createTestFile('low_mileage_001.jpg'),
  odometerPoorLighting: () => createTestFile('poor_lighting_001.jpg'),
  odometerNegative: () => createTestFile('negative_cases_001.jpg')
}