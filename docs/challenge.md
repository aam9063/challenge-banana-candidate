# Banana Bank Technical Challenge

## The situation

You join Banana Bank, a fictional bank preparing to launch its AI assistant on Monday. Customers can consult information and make simulated transfers; operators can handle support cases. The team has a working application, documents and customer history, but needs evidence that it can serve customers reliably.

The product team also wants the assistant to offer something more useful and distinctive than a generic banking chatbot. Your assignment has **two required parts**, delivered together in one ZIP. Choose a realistic scope for each within the available time.

## Part 1 - Prepare for Monday

Explore the application and check whether it is ready for customers. Find and reproduce problems, then fix the ones you choose to tackle. You can focus deeply on one area or improve several. You are joining a team: you are not expected to solve every problem on your own. Explain what you found, why you chose those problems and how your changes help.

Try your changes in the application and show that they work. Use new conversations and operations to check the results, and make sure existing features still work.

**Focus on the web application, the agent and their integration with the bank.** Treat the service in `simulator/` as an external bank and use its API as provided. During evaluation, the application may connect to a separate bank service with the same contract.

## Part 2 - Build something distinctive

Design and implement **a creative, useful feature that makes Banana Bank's agent stand out**. Think about what would make the experience more valuable for a customer or operator, and choose your own direction.

The feature must be part of the agent or its workflow. **You can keep the existing agent as it is and add a new capability**, or build on the experience it already offers. It may include a new interface or other components that work with the agent.

Show your feature working in the application. Explain why you chose it and demonstrate situations where it adds value.

## What you receive

- A runnable web application, agent, tools and simulated bank service.
- Fictional customers and operators, accounts, activity, conversations and support cases.
- Bank documents, editable ingestion and retrieval code, business rules and API contracts.
- Instructions for setup, startup and resetting the environment.

All people, money and operations are simulated. The user selector lets you switch between customers and operators without setting up authentication. You can reorganize the application as long as it continues to work with the bank API.

## Deliverables

Submit **one ZIP containing everything: the complete project with the code for both parts, your complete AI sessions, and your video or alternative explanation**. Keep the AI sessions and supporting materials in a separate **submission/** folder inside that same project ZIP. Return it through the channel specified in your invitation; if you received the challenge by email, reply to that email. A GitHub fork, reviewer repository access and a public deployment are not required.

Include source files, configuration templates, the package lockfile and any data needed to reproduce your work. Leave out credentials, local environment files, installed dependencies, build output and Git history (`.env*` except `.env.example`, `node_modules/`, `.next/` and `.git/`). The ZIP should contain the project at its root or inside one enclosing folder.

Example contents of the single ZIP you submit:

```text
banana-bank.zip
  package.json
  package-lock.json
  README.md              # Setup and startup instructions
  src/, app/, ...        # Complete project: Part 1 + Part 2
  submission/
    README.md            # Explanation and material locations
    ai-sessions/         # Complete original AI session exports
    demo.mp4             # Recommended demonstration
    presentation.pdf     # Alternative to the video
    transcript.vtt       # Optional video transcript
```

The folder and file names are examples. You may use `submission/ai-sessions.zip` instead of the sessions folder; that inner ZIP must also be included in the single ZIP you deliver. List the included files and their relative paths in `submission/README.md`. External links do not replace the AI session files.

### Explain both parts

For Part 1, explain the problems you chose, the changes you made and how you checked that they work. For Part 2, explain your idea, why it is useful and how to try it.

Use the format that helps you explain your decisions clearly. Include enough information for someone else to run your project and see the results.

### Complete AI sessions

You may use your preferred AI tools. Keep the complete sessions from the start and put their original exports in `submission/ai-sessions/`, or in an optional `submission/ai-sessions.zip`, inside your delivery ZIP. Include relevant conversations and, where the tool supports exporting them, intermediate steps, tool calls and recorded results. A retrospective summary does not replace the sessions.

### Video demonstration

**Please submit a video if you can.** Aim for around 5-10 minutes covering both parts. Showing your camera is optional. Explain your decisions and demonstrate your fixes and new feature. Clear explanations matter more than video production quality.

If you cannot provide a video, submit a document or presentation, preferably PDF, covering the same points with screenshots and steps to try your work.

Include the video or alternative document in the same delivery ZIP, alongside the code and AI sessions.

## How your work will be reviewed

We will combine automated checks and human review, using these weights:

| Area | Weight |
|---|---:|
| Part 1: finding and fixing problems | 40% |
| Part 2: a creative, useful agent feature | 40% |
| Across both parts: working method, verification and handoff | 20% |

**You do not need to fix every problem to earn a strong evaluation.** One or two well-chosen problems, solved thoroughly and supported by convincing evidence, can be valued more highly than many superficial fixes. Several meaningful improvements also earn credit: we consider both depth and breadth. Explain your priorities and show what changed, for example with reproducible before/after checks or measurements appropriate to your claim. For Part 2, we will look at creativity, usefulness and how well the feature works with the agent. Across both parts, we will consider your decisions, how you checked your work and how clearly you explain and deliver it.

## Before submitting

- Extract your final ZIP into a fresh folder and run the project using your own instructions.
- Include both parts: your fixes and the implemented agent feature.
- Include the complete AI session files and the recommended video or alternative explanation inside the same ZIP.
- Check that credentials are absent and all included files can be opened after extraction.
- Check that the ZIP contains the complete project and send it through the agreed delivery channel.
- State what is finished, what you verified and what remains pending.
