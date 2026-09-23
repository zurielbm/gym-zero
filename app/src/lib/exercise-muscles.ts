import type { Exercise, MuscleGroup } from '../types'

export const muscleLabels = {
  chest: 'Chest', frontDelts: 'Front shoulders', sideDelts: 'Side shoulders', rearDelts: 'Rear shoulders',
  upperBack: 'Upper back', lats: 'Lats', lowerBack: 'Lower back', biceps: 'Biceps', triceps: 'Triceps',
  forearms: 'Forearms', abs: 'Abs', obliques: 'Side core', quads: 'Quads', hamstrings: 'Hamstrings',
  glutes: 'Glutes', calves: 'Calves', hipAbductors: 'Outer hips', adductors: 'Inner thighs',
} as const
export type MuscleRegion = keyof typeof muscleLabels
export interface ExerciseMuscles {
  primary: MuscleRegion[]
  secondary: MuscleRegion[]
  /** A brief movement distinction, not machine-specific setup instructions. */
  movement: string
  focus: string
}

// Static, general exercise guidance: no AI/network dependency and no intensity percentages.
// Highlight major movers and common assisting groups, not every stabilizing muscle.
const profiles: Record<string, ExerciseMuscles> = {
  'ex-chest-press': { primary: ['chest'], secondary: ['triceps', 'frontDelts'], focus: 'Chest · pushing', movement: 'Press the handles away from your chest, then return with control.' },
  'ex-incline-press': { primary: ['chest'], secondary: ['frontDelts', 'triceps'], focus: 'Upper chest · angled press', movement: 'Press upward and forward on the incline. The angle emphasizes the upper chest.' },
  'ex-shoulder-press': { primary: ['frontDelts', 'sideDelts'], secondary: ['triceps'], focus: 'Shoulders · overhead press', movement: 'Press the handles overhead, then lower them with control.' },
  'ex-pec-fly': { primary: ['chest'], secondary: ['frontDelts'], focus: 'Chest · bring arms together', movement: 'Bring your arms together in front of your chest. On a dual fly station, use its chest-fly setup.' },
  'ex-rear-delt-fly': { primary: ['rearDelts'], secondary: ['upperBack'], focus: 'Rear shoulders · open arms apart', movement: 'Open your arms out to the sides. On a dual fly station, face the chest pad and use its rear-delt setup.' },
  'ex-triceps-pressdown': { primary: ['triceps'], secondary: [], focus: 'Back of upper arms · straighten elbows', movement: 'Keep your upper arms near your sides and straighten your elbows against the cable.' },
  'ex-lat-pulldown': { primary: ['lats'], secondary: ['biceps', 'upperBack'], focus: 'Back · pull down', movement: 'Pull the bar toward your upper chest, bringing your elbows down toward your sides.' },
  'ex-seated-row': { primary: ['lats', 'upperBack'], secondary: ['biceps', 'rearDelts'], focus: 'Back · pull toward you', movement: 'Pull the handles toward your torso, then reach forward with control.' },
  'ex-cable-curl': { primary: ['biceps'], secondary: ['forearms'], focus: 'Front of upper arms · bend elbows', movement: 'Bend your elbows to curl the cable toward you without swinging your torso.' },
  'ex-assisted-pullup': { primary: ['lats'], secondary: ['biceps', 'upperBack'], focus: 'Back · assisted upward pull', movement: 'Pull yourself upward using the machine’s assistance. More assistance makes the movement easier.' },
  'ex-leg-press': { primary: ['quads', 'glutes'], secondary: ['adductors'], focus: 'Thighs & glutes · leg press', movement: 'Push the platform away by extending your knees and hips, then return with control.' },
  'ex-leg-extension': { primary: ['quads'], secondary: [], focus: 'Front of thighs · straighten knees', movement: 'Straighten your knees to raise the pad, then lower it with control.' },
  'ex-leg-curl': { primary: ['hamstrings'], secondary: ['calves'], focus: 'Back of thighs · bend knees', movement: 'Bend your knees against the pad. The seated and lying versions train the same main group.' },
  'ex-hip-adductor': { primary: ['adductors'], secondary: [], focus: 'Inner thighs · bring legs together', movement: 'Bring your thighs together against the pads. On a dual hip station, use its inner-thigh setup.' },
  'ex-hip-abductor': { primary: ['hipAbductors', 'glutes'], secondary: [], focus: 'Outer hips & glutes · open legs', movement: 'Move your thighs apart against the pads, then bring them back with control.' },
  'ex-calf-raise': { primary: ['calves'], secondary: [], focus: 'Calves · raise heels', movement: 'Raise your heels through your available range, then lower them with control.' },
  'ex-hack-squat': { primary: ['quads', 'glutes'], secondary: ['adductors'], focus: 'Thighs & glutes · supported squat', movement: 'Bend your knees and hips to lower the sled, then push through your feet to rise.' },
  'ex-smith-machine-squat': { primary: ['quads', 'glutes'], secondary: ['adductors', 'abs'], focus: 'Thighs & glutes · guided-bar squat', movement: 'Squat along the guided bar path, then stand by extending your hips and knees.' },
  'ex-biceps-curl-machine': { primary: ['biceps'], secondary: ['forearms'], focus: 'Front of upper arms · supported curl', movement: 'Keep your upper arms supported as you bend your elbows to curl the handles.' },
  'ex-triceps-press-machine': { primary: ['triceps'], secondary: ['chest', 'frontDelts'], focus: 'Back of upper arms · press down', movement: 'Press the handles down by straightening your elbows. Handle position can change the emphasis.' },
  'ex-cable-lateral-raise': { primary: ['sideDelts'], secondary: ['upperBack'], focus: 'Side shoulders · lift arms sideways', movement: 'Raise your arm out to the side against the cable, then lower it with control.' },
  'ex-seated-calf-raise': { primary: ['calves'], secondary: [], focus: 'Calves · heels up with bent knees', movement: 'Raise and lower your heels with your knees bent. This emphasizes the deeper calf muscle, the soleus.' },
  'ex-back-extension': { primary: ['lowerBack'], secondary: ['glutes', 'hamstrings'], focus: 'Lower back · extend torso', movement: 'Extend your torso against the machine’s resistance. Hip movement and machine design change the emphasis.' },
  'ex-ab-crunch-machine': { primary: ['abs'], secondary: [], focus: 'Abs · curl torso', movement: 'Bring your ribs toward your pelvis to curl your torso against the pad.' },
}
const groupRegions: Record<MuscleGroup, MuscleRegion[]> = {
  chest: ['chest'], back: ['upperBack', 'lats', 'lowerBack'], shoulders: ['frontDelts', 'sideDelts', 'rearDelts'],
  biceps: ['biceps'], triceps: ['triceps'], quads: ['quads'], hamstrings: ['hamstrings'], glutes: ['glutes'],
  calves: ['calves'], core: ['abs', 'obliques'], hips: ['hipAbductors', 'adductors'],
}
export function exerciseMuscles(exercise: Exercise): ExerciseMuscles & { general: boolean } {
  const profile = profiles[exercise.id]
  if (profile) return { ...profile, general: false }
  return {
    primary: [...new Set(exercise.muscleGroups.flatMap(group => groupRegions[group] ?? []))], secondary: [],
    focus: exercise.muscleGroups.map(group => group[0]!.toUpperCase() + group.slice(1)).join(' · '),
    movement: 'Showing the muscle groups saved for this exercise. Check the station’s instructions for its movement and setup.',
    general: true,
  }
}
