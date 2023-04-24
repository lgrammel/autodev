import * as $ from "js-agent";
import zod from "zod";

export default {
  environment: {
    openAiApiKey: $.agent.env.property("OPENAI_API_KEY"),
  },
  inputSchema: zod.object({
    objective: zod.string(),
  }),
  init: async ({ input }) => input,
  execute: async ({ environment: { openAiApiKey } }) => {
    const generateNewTasks = $.text.generate({
      id: "generate-new-tasks",
      async prompt({
        objective,
        completedTask,
        completedTaskResult,
        existingTasks,
      }: {
        objective: string;
        completedTask: string;
        completedTaskResult: string;
        existingTasks: string[];
      }) {
        return `You are an task creation AI that uses the result of an execution agent to create new tasks with the following objective: ${objective}.
The last completed task has the result: ${completedTaskResult}.
This result was based on this task description: ${completedTask}.
These are the incomplete tasks: ${existingTasks.join(", ")}. 
Based on the result, create new tasks to be completed by the AI system that do not overlap with incomplete tasks.
Return the tasks as an array.`;
      },
      model: $.provider.openai.completionModel({
        apiKey: openAiApiKey,
        model: "text-davinci-003",
        maxTokens: 100,
        temperature: 0.5,
      }),
      processOutput: async (output) => output.trim().split("\n"),
    });

    const prioritizeTasks = $.text.generate({
      id: "prioritize-tasks",
      async prompt({
        tasks,
        objective,
      }: {
        tasks: string[];
        objective: string;
      }) {
        return `You are an task prioritization AI tasked with cleaning the formatting of and reprioritizing the following tasks:
${tasks.join(", ")}.
Consider the ultimate objective of your team: ${objective}.
Do not remove any tasks. 
Return the result as a numbered list, like:
#. First task
#. Second task
Start the task list with number 1.`;
      },
      model: $.provider.openai.completionModel({
        apiKey: openAiApiKey,
        model: "text-davinci-003",
        maxTokens: 1000,
        temperature: 0.5,
      }),
      processOutput: async (output) =>
        output
          .trim()
          .split("\n")
          .map((task) => {
            const [idPart, ...rest] = task.trim().split(".");
            return rest.join(".").trim();
          }),
    });

    return $.step.updateTasksLoop({
      type: "main",
      generateExecutionStep({ task, run }) {
        return new $.step.PromptStep({
          type: "execute-prompt",
          run,
          input: { task },
          async prompt({ task }) {
            return `You are an AI who performs one task based on the following objective: ${run.properties.objective}.
Your task: ${task}
Response:`;
          },
          model: $.provider.openai.completionModel({
            apiKey: openAiApiKey,
            model: "text-davinci-003",
            maxTokens: 2000,
            temperature: 0.7,
          }),
        });
      },
      async updateTaskList(
        {
          runProperties: { objective },
          completedTask,
          completedTaskResult,
          remainingTasks,
        },
        context
      ) {
        const newTasks = await generateNewTasks(
          {
            objective,
            completedTask,
            completedTaskResult,
            existingTasks: remainingTasks,
          },
          context
        );

        return prioritizeTasks(
          {
            objective,
            tasks: remainingTasks.concat(newTasks),
          },
          context
        );
      },
    });
  },
} satisfies $.agent.Agent<
  { openAiApiKey: string },
  { objective: string },
  { objective: string }
>;