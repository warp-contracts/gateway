import Application from 'koa';
import { GatewayContext } from '../init';

export class TaskRunner {
  private constructor(
    private readonly name: string,
    private readonly worker: (context: GatewayContext) => Promise<void>,
    private readonly context: GatewayContext
  ) {}

  static from(name: string, worker: (context: GatewayContext) => Promise<void>, context: GatewayContext): TaskRunner {
    return new TaskRunner(name, worker, context);
  }

  async runSyncEvery(intervalMs: number, initialRun = true): Promise<void> {
    const { name, worker, context } = this;
    context.logger.info(`Starting sync task ${this.name} every ${intervalMs}ms.`);

    if (initialRun) {
      await worker(context);
    }

    (function workerLoop() {
      // not using setInterval on purpose -
      // https://developer.mozilla.org/en-US/docs/Web/API/setInterval#ensure_that_execution_duration_is_shorter_than_interval_frequency
      setTimeout(async function () {
        context.logger.info(`Starting ${name} task.`);
        await worker(context);
        context.logger.info(`Task ${name} completed.`);
        workerLoop();
      }, intervalMs);
    })();
  }

  async runAsyncEvery(intervalMs: number, initialRun = true): Promise<void> {
    const { name, worker, context } = this;
    context.logger.info(`Starting async task ${this.name} every ${intervalMs}ms`);

    if (initialRun) {
      await worker(context);
    }

    (function workerLoop() {
      setTimeout(async function () {
        context.logger.info(`Starting ${name} task.`);
        worker(context)
          .then(() => {
            context.logger.info(`Task ${name} completed.`);
          })
          .catch((r) => {
            context.logger.error(`Task ${name} error.`, r);
          });
        workerLoop();
      }, intervalMs);
    })();
  }
}
