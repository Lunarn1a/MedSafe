import assert from 'node:assert/strict';
import test from 'node:test';
import { interactions } from '../assets/js/data/medicine-catalog.js';
import { checkReferenceInteractions, getInteractionLevel } from '../assets/js/services/interaction-service.js';
import { findMedicine, getCatalogSummary, searchMedicines } from '../assets/js/services/medicine-service.js';

test('exposes the complete catalog through the medicine service', () => {
  assert.equal(getCatalogSummary().medicineCount, 1242);
  assert.equal(findMedicine('acetaminophen'), 'Acetaminophen');
  assert.ok(searchMedicines('acetaminophen').includes('Acetaminophen'));
});

test('returns a cataloged reference interaction regardless of medicine order', () => {
  const [pair, severity] = Object.entries(interactions)[0];
  const [medicineA, medicineB] = pair.split('|||');

  assert.equal(getInteractionLevel(medicineA, medicineB), severity);
  assert.equal(getInteractionLevel(medicineB, medicineA), severity);
  assert.deepEqual(checkReferenceInteractions([medicineB, medicineA]), [
    { medicineA: medicineB, medicineB: medicineA, severity },
  ]);
});

test('does not infer an interaction that is absent from the local catalog', () => {
  assert.equal(getInteractionLevel('Acetaminophen', 'Not a catalog medicine'), null);
  assert.deepEqual(checkReferenceInteractions(['Acetaminophen', 'Not a catalog medicine']), []);
});
