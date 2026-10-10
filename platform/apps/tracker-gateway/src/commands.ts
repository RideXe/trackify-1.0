import type { DeviceIdentity, PendingCommand } from '@trackify/data';
import type { CommandResults, SessionRegistry } from './session';

/** The command-table operations delivery needs (DynamoCommandStore in production). */
export interface CommandQueue {
  pending(now: number): Promise<PendingCommand[]>;
  markSent(key: PendingCommand, now: number, correlation?: number): Promise<boolean>;
  markFailed(key: PendingCommand, now: number, reason: string): Promise<boolean>;
  markDelivered(key: PendingCommand, now: number, result: string): Promise<boolean>;
  recordEvent(event: {
    tenantId: string;
    deviceId: string;
    type: 'commandResult' | 'queuedCommandSent';
    eventTime: number;
    attributes: Record<string, string | number | boolean>;
  }): Promise<void>;
}

/** A command older than this when sent was queued while the vehicle was away. */
const QUEUED_AFTER_MS = 30_000;

/**
 * Delivers waiting commands to devices connected to this task. Each command is claimed with a
 * conditional write before it is sent, so two tasks never send the same command.
 */
export class CommandDispatcher {
  private running = false;

  constructor(
    private readonly queue: CommandQueue,
    private readonly sessions: SessionRegistry,
    private readonly now: () => number = Date.now,
  ) {}

  async dispatchOnce(): Promise<number> {
    if (this.running || !this.sessions.size) return 0;
    this.running = true;
    let sent = 0;
    try {
      const now = this.now();
      for (const command of await this.queue.pending(now)) {
        const session = this.sessions.get(command.deviceId);
        if (!session) continue;
        if (!(await this.queue.markSent(command, now))) continue;
        const delivery = session.deliver(command);
        if (!delivery.sent) {
          await this.queue.markFailed(
            command,
            now,
            'this tracker protocol cannot send that command',
          );
          continue;
        }
        sent += 1;
        if (now - command.createdAt > QUEUED_AFTER_MS)
          await this.queue.recordEvent({
            tenantId: command.tenantId,
            deviceId: command.deviceId,
            type: 'queuedCommandSent',
            eventTime: now,
            attributes: { commandId: command.commandId, commandType: command.type },
          });
      }
    } finally {
      this.running = false;
    }
    return sent;
  }

  start(intervalMs = 2_000) {
    return setInterval(() => {
      this.dispatchOnce().catch((error: unknown) =>
        console.error('command dispatch failed', { error }),
      );
    }, intervalMs);
  }
}

/** Marks the answered command delivered and records the reply as a commandResult event. */
export function commandResults(queue: CommandQueue, now: () => number = Date.now): CommandResults {
  return {
    async delivered(device: DeviceIdentity, command: PendingCommand | undefined, result: string) {
      const at = now();
      if (command) await queue.markDelivered(command, at, result.slice(0, 1_000));
      await queue.recordEvent({
        tenantId: device.tenantId,
        deviceId: device.deviceId,
        type: 'commandResult',
        eventTime: at,
        attributes: {
          result: result.slice(0, 1_000),
          ...(command ? { commandId: command.commandId, commandType: command.type } : {}),
        },
      });
    },
  };
}
