import * as Alexa from "ask-sdk-core";
import type { Config } from "./config.js";
import type { BridgeStore } from "./store.js";
import { TaskRunner } from "./tasks.js";
import type { BridgeTask } from "./types.js";

export function createSkill(config: Config, store: BridgeStore, runner: TaskRunner): Alexa.Skill {
  const launchHandler: Alexa.RequestHandler = {
    canHandle: (input) => Alexa.getRequestType(input.requestEnvelope) === "LaunchRequest",
    handle: async (input) => {
      const userId = alexaUserId(input);
      const clawId = await store.getPairing(userId);
      const speech = clawId
        ? "Your Claw is ready. What would you like me to do?"
        : "This Alexa account is not paired. Say, pair my Claw, to get a pairing code.";
      return input.responseBuilder.speak(speech).reprompt("What would you like me to ask your Claw?").getResponse();
    },
  };

  const pairHandler: Alexa.RequestHandler = {
    canHandle: (input) => intentIs(input, "PairClawIntent"),
    handle: async (input) => {
      const userId = alexaUserId(input);
      const pending = await store.createPairingCode(userId);
      const spokenCode = pending.code.split("").join(" ");
      return input.responseBuilder
        .speak(`Your pairing code is ${spokenCode}. It expires in ten minutes. Claim it from your Claw bridge setup.`)
        .withShouldEndSession(true)
        .getResponse();
    },
  };

  const askHandler: Alexa.RequestHandler = {
    canHandle: (input) => intentIs(input, "AskClawIntent"),
    handle: async (input) => {
      const userId = alexaUserId(input);
      const clawId = await store.getPairing(userId);
      if (!clawId) return input.responseBuilder.speak("Pair your Claw first by saying, pair my Claw.").getResponse();
      const prompt = Alexa.getSlotValue(input.requestEnvelope, "query")?.trim();
      if (!prompt) return input.responseBuilder.speak("What would you like me to ask your Claw?").reprompt("What should I ask?").getResponse();
      const requestId = input.requestEnvelope.request.requestId;
      const task = await runner.enqueue(userId, clawId, prompt, requestId);
      const result = await runner.waitForTerminal(task.id, config.fastResponseBudgetMs);
      return input.responseBuilder.speak(speechForTask(result, true)).withShouldEndSession(true).getResponse();
    },
  };

  const statusHandler: Alexa.RequestHandler = {
    canHandle: (input) => intentIs(input, "TaskStatusIntent"),
    handle: async (input) => {
      const task = await store.latestTask(alexaUserId(input));
      const speech = task ? speechForTask(task, false) : "You don't have any recent Claw tasks.";
      return input.responseBuilder.speak(speech).withShouldEndSession(true).getResponse();
    },
  };

  const unpairHandler: Alexa.RequestHandler = {
    canHandle: (input) => intentIs(input, "UnpairClawIntent"),
    handle: async (input) => {
      await store.unpair(alexaUserId(input));
      return input.responseBuilder.speak("Your Claw is unpaired. You can pair another one at any time.").withShouldEndSession(true).getResponse();
    },
  };

  const cancelTaskHandler: Alexa.RequestHandler = {
    canHandle: (input) => intentIs(input, "CancelTaskIntent"),
    handle: async (input) => {
      const cancelled = await runner.cancelLatest(alexaUserId(input));
      return input.responseBuilder.speak(cancelled ? "I cancelled your latest Claw task." : "There isn't a running Claw task to cancel.").getResponse();
    },
  };

  const helpHandler: Alexa.RequestHandler = {
    canHandle: (input) => intentIs(input, "AMAZON.HelpIntent"),
    handle: (input) => input.responseBuilder
      .speak("Ask me to do something with your Claw, or ask for a status update. For example, say, ask my Claw to check the server backups.")
      .reprompt("What would you like your Claw to do?")
      .getResponse(),
  };

  const stopHandler: Alexa.RequestHandler = {
    canHandle: (input) => ["AMAZON.StopIntent", "AMAZON.CancelIntent", "AMAZON.NavigateHomeIntent"].some((name) => intentIs(input, name)),
    handle: (input) => input.responseBuilder.speak("Goodbye.").withShouldEndSession(true).getResponse(),
  };

  const fallbackHandler: Alexa.RequestHandler = {
    canHandle: (input) => intentIs(input, "AMAZON.FallbackIntent"),
    handle: (input) => input.responseBuilder.speak("I didn't catch that. Try saying, ask my Claw to, followed by your request.").reprompt("What should I ask your Claw?").getResponse(),
  };

  const errorHandler: Alexa.ErrorHandler = {
    canHandle: () => true,
    handle: (input, error) => {
      console.error("Alexa request failed", error);
      return input.responseBuilder.speak("I couldn't reach your Claw bridge just now. Please try again.").getResponse();
    },
  };

  let builder = Alexa.SkillBuilders.custom()
    .addRequestHandlers(launchHandler, pairHandler, askHandler, statusHandler, cancelTaskHandler, unpairHandler, helpHandler, stopHandler, fallbackHandler)
    .addErrorHandlers(errorHandler);
  if (config.alexaApplicationId) builder = builder.withSkillId(config.alexaApplicationId);
  return builder.create();
}

function intentIs(input: Alexa.HandlerInput, intentName: string): boolean {
  return Alexa.getRequestType(input.requestEnvelope) === "IntentRequest" && Alexa.getIntentName(input.requestEnvelope) === intentName;
}

function alexaUserId(input: Alexa.HandlerInput): string {
  return input.requestEnvelope.context?.System.user.userId ?? input.requestEnvelope.session?.user.userId ?? "unknown-user";
}

function speechForTask(task: BridgeTask, justSubmitted: boolean): string {
  if (task.status === "completed") return task.result ?? "Your Claw finished without a spoken result.";
  if (task.status === "failed") return `Your Claw couldn't complete ${task.title}. ${task.error ?? "Ask me to try again."}`;
  if (task.status === "cancelled") return `The task ${task.title} was cancelled.`;
  if (justSubmitted) return `I've started ${task.title}. You can ask me for a status update.`;
  return `Your task, ${task.title}, is still ${task.status}.`;
}
