import { interactions } from '../data/medicine-catalog.js';

const severityRank = { Major: 1, Moderate: 2, Minor: 3 };

function toPairKey(firstMedicine, secondMedicine) {
  return [firstMedicine, secondMedicine]
    .map((medicine) => String(medicine || '').trim().toLocaleLowerCase())
    .sort()
    .join('|||');
}

export function getInteractionLevel(firstMedicine, secondMedicine) {
  return interactions[toPairKey(firstMedicine, secondMedicine)] || null;
}

export function checkReferenceInteractions(medicines) {
  const selectedMedicines = medicines
    .map((medicine) => typeof medicine === 'string' ? medicine : medicine.display_name || medicine.name)
    .filter(Boolean);
  const detectedInteractions = [];

  for (let firstIndex = 0; firstIndex < selectedMedicines.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < selectedMedicines.length; secondIndex += 1) {
      const medicineA = selectedMedicines[firstIndex];
      const medicineB = selectedMedicines[secondIndex];
      const severity = getInteractionLevel(medicineA, medicineB);

      if (severity) {
        detectedInteractions.push({ medicineA, medicineB, severity });
      }
    }
  }

  return detectedInteractions.sort(
    (firstResult, secondResult) => severityRank[firstResult.severity] - severityRank[secondResult.severity],
  );
}

export const interactionService = {
  checkInteractions: checkReferenceInteractions,
};
