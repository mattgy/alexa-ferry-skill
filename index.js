// Red Hook Ferry Skill - Enhanced Version
const Alexa = require('ask-sdk-core');
const moment = require('moment-timezone');
const FerryService = require('./ferryService');
const Utils = require('./utils');
const config = require('./config');

// Initialize ferry service
const ferryService = new FerryService();

// Initialize the service with static GTFS data
let serviceInitialized = false;
async function ensureServiceInitialized() {
  if (!serviceInitialized) {
    try {
      await ferryService.initialize();
      serviceInitialized = true;
    } catch (error) {
      console.error('Failed to initialize ferry service:', error.message);
      // Continue with fallback behavior
    }
  }
}

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  async handle(handlerInput) {
    Utils.log('info', 'Launch request received');
    
    try {
      // Get current service status and any alerts
      const alerts = await ferryService.getServiceAlerts();
      let speakOutput = 'Welcome to Red Hook Ferry Checker. ';
      
      // Add any critical alerts to welcome message
      const criticalAlerts = alerts.filter(alert => 
        alert.severity === 'SEVERE' || alert.severity === 'HIGH'
      );
      
      if (criticalAlerts.length > 0) {
        speakOutput += `Important: ${criticalAlerts[0].header}. `;
      }
      
      speakOutput += 'You can ask me about the next ferries leaving from Red Hook in Brooklyn, or ask for ferries after a specific time.';
      
      const reprompt = 'Try asking: when is the next ferry from Red Hook?';
      
      return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt(reprompt)
        .getResponse();
    } catch (error) {
      Utils.log('error', 'Error in launch handler', { error: error.message });
      
      const fallbackOutput = 'Welcome to Red Hook Ferry Checker. You can ask me about the next ferries leaving from Red Hook in Brooklyn.';
      
      return handlerInput.responseBuilder
        .speak(fallbackOutput)
        .reprompt('Try asking: when is the next ferry?')
        .getResponse();
    }
  }
};

const GetNextFerriesIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetNextFerriesIntent';
  },
  async handle(handlerInput) {
    const requestId = handlerInput.requestEnvelope.request.requestId;
    Utils.log('info', 'GetNextFerriesIntent received', { requestId });
    Utils.log('info', 'LAMBDA UPDATED');
    
    try {
      // Ensure ferry service is initialized with static GTFS data
      await ensureServiceInitialized();
      
      // Get ferry data and alerts
      const [ferryData, alerts] = await Promise.all([
        ferryService.getFerrySchedule(),
        ferryService.getServiceAlerts()
      ]);
      
      if (!ferryData) {
        return handlerInput.responseBuilder
          .speak('I\'m sorry, I couldn\'t retrieve the ferry schedule at this time. Please try again later.')
          .getResponse();
      }
      
      // Get departures for both directions
      const now = new Date();
      const northboundDepartures = ferryService.getNextRedHookDepartures(ferryData, now, 'northbound');
      const southboundDepartures = ferryService.getNextRedHookDepartures(ferryData, now, 'southbound');
      
      // Combine and sort all departures by time
      let allDepartures = [...northboundDepartures, ...southboundDepartures]
        .sort((a, b) => a.time - b.time)
        .slice(0, 6); // Show up to 6 total departures

      if (allDepartures.length === 0) {
        const tomorrow = moment().tz(config.TIMEZONE).add(1, 'day').startOf('day').toDate();
        const nextDayNorthbound = ferryService.getNextRedHookDepartures(ferryData, tomorrow, 'northbound');
        const nextDaySouthbound = ferryService.getNextRedHookDepartures(ferryData, tomorrow, 'southbound');
        allDepartures = [...nextDayNorthbound, ...nextDaySouthbound]
          .sort((a, b) => a.time - b.time)
          .slice(0, 6);
      }
      
      const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
      const speakOutput = ferryService.formatDeparturesForSpeech(allDepartures, alerts, null, null, sessionAttributes);
      
      // Update session attributes
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
      
      // Check for different prompts
      if (speakOutput.includes('Would you like to hear more about tomorrow\'s schedule?')) {
        sessionAttributes.promptedForNextDay = true;
        handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
        
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .reprompt('Would you like to hear more about tomorrow\'s schedule?')
          .getResponse();
      }
      
      if (speakOutput.includes('Would you like to hear about current service alerts')) {
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .reprompt('Would you like to hear about current service alerts for this route?')
          .getResponse();
      }
      
      return handlerInput.responseBuilder
        .speak(speakOutput)
        .getResponse();
        
    } catch (error) {
      Utils.log('error', 'Error in GetNextFerriesIntent', { 
        requestId,
        error: error.message
      });
      
      return handlerInput.responseBuilder
        .speak('I\'m sorry, I had trouble getting the ferry schedule. Please try again.')
        .getResponse();
    }
  }
};

const GetNextDayFerriesIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.YesIntent';
  },
  async handle(handlerInput) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    
    if (sessionAttributes.alertsOffered) {
      try {
        await ensureServiceInitialized();
        
        const alerts = await ferryService.getServiceAlerts();
        const relevantAlerts = alerts.filter(alert => alert.informedEntity && alert.informedEntity.some(entity => 
          entity.routeId === config.SOUTH_BROOKLYN_ROUTE_ID
        ));
        
        const alertSpeech = ferryService.formatServiceAlertsForSpeech(relevantAlerts);
        
        // Mark that alerts have been mentioned in this session
        sessionAttributes.alertsMentioned = true;
        sessionAttributes.alertsOffered = false;
        handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
        
        return handlerInput.responseBuilder
          .speak(alertSpeech)
          .getResponse();
          
      } catch (error) {
        Utils.log('error', 'Error in GetServiceAlertsIntent', { error: error.message });
        return handlerInput.responseBuilder
          .speak('I\'m sorry, I couldn\'t retrieve service alerts at this time.')
          .getResponse();
      }
    } else if (sessionAttributes.promptedForNextDay) {
      try {
        await ensureServiceInitialized();
        
        const tomorrow = moment().tz(config.TIMEZONE).add(1, 'day').startOf('day').toDate();
        const departures = ferryService.getStaticScheduleDepartures(tomorrow);
        
        const speakOutput = ferryService.formatDeparturesForSpeech(departures);
        
        // Clear the session attribute
        sessionAttributes.promptedForNextDay = false;
        handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
        
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .getResponse();
          
      } catch (error) {
        Utils.log('error', 'Error in GetNextDayFerriesIntent', { error: error.message });
        return handlerInput.responseBuilder
          .speak('I\'m sorry, I had trouble getting tomorrow\'s schedule. Please try again.')
          .getResponse();
      }
    }
    
    // If not prompted for next day, fall back to a generic response
    return handlerInput.responseBuilder
      .speak("I'm not sure what you're saying yes to. You can ask me about the next ferries from Red Hook.")
      .reprompt('What would you like to know?')
      .getResponse();
  }
};

const GetFerriesAfterTimeIntentHandler = {
  canHandle(handlerInput) {

    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetFerriesAfterTimeIntent';
  },
  async handle(handlerInput) {
    const requestId = handlerInput.requestEnvelope.request.requestId;
    const slots = handlerInput.requestEnvelope.request.intent.slots;
    
    Utils.log('info', 'GetFerriesAfterTimeIntent received', { 
      requestId,
      slots: Object.keys(slots).reduce((acc, key) => {
        acc[key] = slots[key].value;
        return acc;
      }, {})
    });
    
    try {
      // Ensure ferry service is initialized with static GTFS data
      await ensureServiceInitialized();
      
      // Extract and validate time from slot
      const timeSlot = slots.time;
      let searchTime = new Date();
      
      if (timeSlot && timeSlot.value) {
        const parsedTime = Utils.parseTimeFromSpeech(timeSlot.value);
        if (parsedTime) {
          // Validate that the time is reasonable (not more than 24 hours in the future)
          const now = moment().tz(config.TIMEZONE);
          const timeDiff = parsedTime.diff(now, 'hours');
          
          if (timeDiff > 24) {
            return handlerInput.responseBuilder
              .speak('I can only check ferry times for today and tomorrow. Please ask for a time within the next 24 hours.')
              .reprompt('What time would you like to check for ferries?')
              .getResponse();
          }
          
          searchTime = parsedTime.toDate();
        } else {
          return handlerInput.responseBuilder
            .speak('I didn\'t understand that time. Please try saying something like \'after 3 PM\' or \'after 2:30\'.')
            .reprompt('What time would you like to check for ferries after?')
            .getResponse();
        }
      }
      
      // Get ferry data and alerts
      const [ferryData, alerts] = await Promise.all([
        ferryService.getFerrySchedule(),
        ferryService.getServiceAlerts()
      ]);
      
      if (!ferryData) {
        return handlerInput.responseBuilder
          .speak('I\'m sorry, I couldn\'t retrieve the ferry schedule at this time. Please try again later.')
          .getResponse();
      }
      
      const departures = ferryService.getNextRedHookDepartures(ferryData, searchTime);
      
      let speakOutput;
      if (timeSlot && timeSlot.value) {
        const timeStr = moment(searchTime).tz(config.TIMEZONE).format('h:mm A');
        speakOutput = `Looking for ferries after ${timeStr}. `;
      } else {
        speakOutput = '';
      }
      
      const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
      speakOutput += ferryService.formatDeparturesForSpeech(departures, alerts, null, null, sessionAttributes);
      
      // Update session attributes
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
      
      if (speakOutput.includes('Would you like to hear about current service alerts')) {
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .reprompt('Would you like to hear about current service alerts for this route?')
          .getResponse();
      }
      
      return handlerInput.responseBuilder
        .speak(speakOutput)
        .getResponse();
        
    } catch (error) {
      Utils.log('error', 'Error in GetFerriesAfterTimeIntent', { 
        requestId,
        error: error.message
      });
      
      return handlerInput.responseBuilder
        .speak('I\'m sorry, I had trouble understanding the time you specified. Try asking for the next ferries from Red Hook.')
        .getResponse();
    }
  }
};

const GetFerriesWithDirectionIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetFerriesWithDirectionIntent';
  },
  async handle(handlerInput) {
    const requestId = handlerInput.requestEnvelope.request.requestId;
    const slots = handlerInput.requestEnvelope.request.intent.slots;
    
    Utils.log('info', 'GetFerriesWithDirectionIntent received', { 
      requestId,
      slots: Object.keys(slots).reduce((acc, key) => {
        acc[key] = slots[key].value;
        return acc;
      }, {})
    });
    
    try {
      // Ensure ferry service is initialized with static GTFS data
      await ensureServiceInitialized();
      
      // Extract destination from slot
      const destinationSlot = slots.destination;
      const timeSlot = slots.time;
      
      if (!destinationSlot || !destinationSlot.value) {
        return handlerInput.responseBuilder
          .speak('I need to know which direction you want to go. Try asking for ferries to Wall Street, or ferries towards Bay Ridge.')
          .reprompt('Which direction would you like to go? You can say Wall Street, Bay Ridge, or Corlears Hook.')
          .getResponse();
      }
      
      const destination = Utils.sanitizeInput(destinationSlot.value);
      const direction = this.determineDirection(destination);
      
      if (!direction) {
        return handlerInput.responseBuilder
          .speak(`I'm not sure which direction ${destination} is. Try asking for ferries to Wall Street, Bay Ridge, or Corlears Hook.`)
          .reprompt('Which direction would you like to go?')
          .getResponse();
      }
      
      // Handle time if provided
      let searchTime = new Date();
      if (timeSlot && timeSlot.value) {
        const parsedTime = Utils.parseTimeFromSpeech(timeSlot.value);
        if (parsedTime) {
          searchTime = parsedTime.toDate();
        }
      }
      
      // Get ferry data and alerts
      const [ferryData, alerts] = await Promise.all([
        ferryService.getFerrySchedule(),
        ferryService.getServiceAlerts()
      ]);
      
      if (!ferryData) {
        return handlerInput.responseBuilder
          .speak('I\'m sorry, I couldn\'t retrieve the ferry schedule at this time. Please try again later.')
          .getResponse();
      }
      
      const departures = ferryService.getNextRedHookDepartures(ferryData, searchTime, direction);
      const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
      const speakOutput = ferryService.formatDeparturesForSpeech(departures, alerts, direction, destination, sessionAttributes);
      
      // Update session attributes
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
      
      if (speakOutput.includes('Would you like to hear about current service alerts')) {
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .reprompt('Would you like to hear about current service alerts for this route?')
          .getResponse();
      }
      
      return handlerInput.responseBuilder
        .speak(speakOutput)
        .getResponse();
        
    } catch (error) {
      Utils.log('error', 'Error in GetFerriesWithDirectionIntent', { 
        requestId,
        error: error.message
      });
      
      return handlerInput.responseBuilder
        .speak('I\'m sorry, I had trouble finding ferries in that direction. Try asking for ferries to Wall Street or Bay Ridge.')
        .getResponse();
    }
  },
  
  determineDirection(destination) {
    const dest = destination.toLowerCase();
    
    // Northbound destinations (towards Corlears Hook)
    if (dest.includes('wall street') || dest.includes('wall st') || dest.includes('pier 11') ||
        dest.includes('dumbo') || dest.includes('fulton ferry') ||
        dest.includes('atlantic') || dest.includes('bbp') || dest.includes('pier 6') ||
        dest.includes('corlears') || dest.includes('manhattan') || dest.includes('financial district')) {
      return 'northbound';
    }
    
    // Southbound destinations (towards Bay Ridge)
    if (dest.includes('bay ridge') || dest.includes('sunset park') || dest.includes('bat') ||
        dest.includes('governors island') || dest.includes('south')) {
      return 'southbound';
    }
    
    return null;
  }
};

const GetServiceAlertsIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetServiceAlertsIntent';
  },
  async handle(handlerInput) {
    const requestId = handlerInput.requestEnvelope.request.requestId;
    Utils.log('info', 'GetServiceAlertsIntent received', { requestId });
    
    try {
      // Ensure ferry service is initialized with static GTFS data
      await ensureServiceInitialized();
      
      const alerts = await ferryService.getServiceAlerts();
      const relevantAlerts = alerts.filter(alert => alert.informedEntity && alert.informedEntity.some(entity => 
        entity.routeId === config.SOUTH_BROOKLYN_ROUTE_ID
      ));
      
      const speakOutput = ferryService.formatServiceAlertsForSpeech(relevantAlerts);
      
      // Mark that alerts have been mentioned in this session
      const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
      sessionAttributes.alertsMentioned = true;
      handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
      
      return handlerInput.responseBuilder
        .speak(speakOutput)
        .getResponse();
        
    } catch (error) {
      Utils.log('error', 'Error in GetServiceAlertsIntent', { 
        requestId,
        error: error.message
      });
      
      return handlerInput.responseBuilder
        .speak('I\'m sorry, I couldn\'t check for service alerts at this time.')
        .getResponse();
    }
  }
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    const speakOutput = `I can help you check ferry schedules from Red Hook in Brooklyn. Here are some things you can ask me:
    
    Say "when is the next ferry" to get the next departures.
    Say "ferries after 3 PM" to get departures after a specific time.
    Say "are there any service alerts" to check for delays or disruptions.
    
    What would you like to know?`;

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt('What would you like to know about Red Hook ferry service?')
      .getResponse();
  }
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
        || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
  },
  handle(handlerInput) {
    const speakOutput = 'Goodbye!';
    
    return handlerInput.responseBuilder
      .speak(speakOutput)
      .getResponse();
  }
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.getResponse();
  }
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    const requestId = handlerInput.requestEnvelope.request.requestId;
    
    Utils.log('error', 'Unhandled error occurred', { 
      requestId,
      error: error.message,
      stack: error.stack
    });
    
    const speakOutput = 'Sorry, I had trouble doing what you asked. Please try again.';
    
    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt('You can ask me about the next ferries from Red Hook.')
      .getResponse();
  }
};

// Request interceptor for logging
const RequestInterceptor = {
  process(handlerInput) {
    const requestType = Alexa.getRequestType(handlerInput.requestEnvelope);
    const intentName = requestType === 'IntentRequest' ? 
      Alexa.getIntentName(handlerInput.requestEnvelope) : requestType;
    
    Utils.log('info', 'Request received', {
      requestId: handlerInput.requestEnvelope.request.requestId,
      type: requestType,
      intent: intentName,
      timestamp: handlerInput.requestEnvelope.request.timestamp
    });
  }
};

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    GetNextFerriesIntentHandler,
    GetNextDayFerriesIntentHandler,
    GetFerriesWithDirectionIntentHandler,
    GetFerriesAfterTimeIntentHandler,
    GetServiceAlertsIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    SessionEndedRequestHandler
  )
  .addRequestInterceptors(RequestInterceptor)
  .addErrorHandlers(ErrorHandler)
  .lambda();
