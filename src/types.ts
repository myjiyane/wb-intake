export type ImageRole =
  | 'exterior_front_34' | 'exterior_rear_34' | 'left_side' | 'right_side'
  | 'interior_front' | 'interior_rear' | 'dash_odo' | 'engine_bay'
  | 'tyre_fl' | 'tyre_fr' | 'tyre_rl' | 'tyre_rr';

export interface Checklist {
  vin: string;
  lot_id?: string;
  checklist: {
    hasDekra: boolean;
    hasOdo: boolean;
    photosOk: boolean;
    dtcStatus: 'green'|'amber'|'red'|'n/a';
    requiredCount: number;
    presentCount: number;
    missing: ImageRole[];
  };
  ready: boolean;
}