import * as Alexa from "ask-sdk-core";
import type { Config } from "./config.js";
import { StateStore } from "./store.js";
import { TaskRunner } from "./tasks.js";
import type { BridgeTask } from "./types.js";

export function createSkill(config: Config, store: StateStore, runner: TaskRunner): Alexa.Skill {
  const launchHandler: Alexa.RequestHandler = {
    canHandle: (input) => Alexa.getRequestType(input.requestEnvelope) === "LaunchRequest",
    handle: async (input) => {
      const userId = alexaUserId(input);
      const clawId = await ensureSinglePairing(config, store, userId);
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
      if (config.installations.length === 1 && config.autoPairSingleClaw) {
        await store.pair(userId, config.installations[0]!.id);
        return input.responseBuilder.speak(`Paired with ${config.installations[0]!.name}. You can ask me something now.`).reprompt("What would you like to ask?").getResponse();
      }
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
      const clawId = store.getPairing(userId) ?? await ensureSinglePairing(config, store, userId);
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
    handle: (input) => {
      const task = store.latestTask(alexaUserId(input));
      const speech = task ? speechForTask(task, false) : "You don't have any recent Claw tasks.";
      return input.responseBuilder.speak(speech).withShouldEndSession(true).getResponse();
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
    .addRequestHandlers(launchHandler, pairHandler, askHandler, statusHandler, cancelTaskHandler, helpHandler, stopHandler, fallbackHandler)
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

async function ensureSinglePairing(config: Config, store: StateStore, userId: string): Promise<string | undefined> {
  const paired = store.getPairing(userId);
  if (paired) return paired;
  if (config.autoPairSingleClaw && config.installations.length === 1) {
    await store.pair(userId, config.installations[0]!.id);
    return config.installations[0]!.id;
  }
  return undefined;
}

function speechForTask(task: BridgeTask, justSubmitted: boolean): string {
  if (task.status === "completed") return task.result ?? "Your Claw finished without a spoken result.";
  if (task.status === "failed") return `Your Claw couldn't complete ${task.title}. ${task.error ?? "Ask me to try again."}`;
  if (task.status === "cancelled") return `The task ${task.title} was cancelled.`;
  if (justSubmitted) return `I've started ${task.title}. You can ask me for a status update.`;
  return `Your task, ${task.title}, is still ${task.status}.`;
}
