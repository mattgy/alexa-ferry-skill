const fs = require('fs');
const path = require('path');

// Read and parse the interaction model
const modelPath = path.join(__dirname, '../skill-package/interactionModels/custom/en-US.json');
const interactionModel = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
const intents = interactionModel.interactionModel.languageModel.intents;

// Helper to convert Alexa sample utterances with {slots} into regular expressions
function createRegexFromSample(sample) {
  // Escape regex special characters first, but leave {} alone for now
  let regexStr = sample.replace(/[-[\]/()*+?.\\^$|]/g, '\\$&');
  
  // Replace Alexa slots {slotName} with a more restrictive wildcard
  // Using .+ to ensure it matches at least something for the slot
  regexStr = regexStr.replace(/\{[^}]+\}/g, '(.+)');
  
  // Make sure it matches the whole string (ignoring case)
  return new RegExp(`^${regexStr}$`, 'i');
}

// Map each intent to its generated regexes
const intentRegexes = {};
intents.forEach(intent => {
  if (intent.samples && intent.samples.length > 0) {
    intentRegexes[intent.name] = intent.samples.map(createRegexFromSample);
  }
});

// Helper function to resolve an utterance to an intent
function resolveUtterance(utterance) {
  // Clean the utterance to mimic basic Alexa preprocessing
  const cleanedUtterance = utterance.toLowerCase().replace(/[.,?!]/g, '').trim();

  let matchedIntents = [];

  for (const [intentName, regexes] of Object.entries(intentRegexes)) {
    for (const regex of regexes) {
      if (regex.test(cleanedUtterance)) {
        matchedIntents.push(intentName);
        break; // Stop checking regexes for this intent if one matched
      }
    }
  }

  return matchedIntents;
}

describe('Interaction Model Utterances', () => {
  const testCases = [
    // GetNextFerriesIntent Expected Utterances
    { utterance: 'when is the next ferry', expectedIntent: 'GetNextFerriesIntent' },
    { utterance: 'when is the next boat', expectedIntent: 'GetNextFerriesIntent' },
    { utterance: 'what time is the next ferry', expectedIntent: 'GetNextFerriesIntent' },
    { utterance: 'what time is the next boat', expectedIntent: 'GetNextFerriesIntent' },
    { utterance: 'next ferry', expectedIntent: 'GetNextFerriesIntent' },
    { utterance: 'next boat', expectedIntent: 'GetNextFerriesIntent' },
    { utterance: 'when do ferries leave', expectedIntent: 'GetNextFerriesIntent' },
    
    // GetFerriesWithDirectionIntent Expected Utterances
    { utterance: 'ferries to Manhattan', expectedIntent: 'GetFerriesWithDirectionIntent' },
    { utterance: 'when is the next ferry to Wall Street', expectedIntent: 'GetFerriesWithDirectionIntent' },
    { utterance: 'ferry to Dumbo', expectedIntent: 'GetFerriesWithDirectionIntent' },
    { utterance: 'boats to Manhattan', expectedIntent: 'GetFerriesWithDirectionIntent' },
    { utterance: 'next boat to Pier 11', expectedIntent: 'GetFerriesWithDirectionIntent' },
    
    // GetFerriesAfterTimeIntent Expected Utterances
    { utterance: 'ferries after 3 PM', expectedIntent: 'GetFerriesAfterTimeIntent' },
    { utterance: 'what ferries leave after 5:00', expectedIntent: 'GetFerriesAfterTimeIntent' },
    { utterance: 'ferry schedule after 2', expectedIntent: 'GetFerriesAfterTimeIntent' },
    { utterance: 'boats after 4 PM', expectedIntent: 'GetFerriesAfterTimeIntent' },
    { utterance: 'boat schedule after 6', expectedIntent: 'GetFerriesAfterTimeIntent' },
    
    // GetServiceAlertsIntent Expected Utterances
    { utterance: 'are there any service alerts', expectedIntent: 'GetServiceAlertsIntent' },
    { utterance: 'service alerts', expectedIntent: 'GetServiceAlertsIntent' },
    { utterance: 'are there any delays', expectedIntent: 'GetServiceAlertsIntent' },
    { utterance: 'boat alerts', expectedIntent: 'GetServiceAlertsIntent' }
  ];

  testCases.forEach(({ utterance, expectedIntent }) => {
    test(`Utterance "${utterance}" should resolve to ${expectedIntent}`, () => {
      const matchedIntents = resolveUtterance(utterance);
      
      // Ensure it matched the expected intent
      if (!matchedIntents.includes(expectedIntent)) {
        throw new Error(`Utterance "${utterance}" did not match expected intent "${expectedIntent}". Matches found: [${matchedIntents.join(', ')}]`);
      }
      
      expect(matchedIntents).toContain(expectedIntent);
    });
  });
});
