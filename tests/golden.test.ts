import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeDecision, decodeEvent, encodeDecision } from '../src/adapters/codec';
import { OfflineCartModel } from '../src/adapters/offline';
import { addObservation, initialState, replayAgentState } from '../src/core/agent';
import type { AgentEvent } from '../src/core/contracts';

describe('pinned real-tool golden corpus', () => {
  it('replays five captured runs through fake and production Pi codec paths', async () => {
    const directory = path.resolve('artifacts/golden');
    const files = (await readdir(directory)).filter(f => f.endsWith('.json'));
    expect(files).toHaveLength(5);
    for (const file of files) {
      const raw = JSON.parse(await readFile(path.join(directory, file), 'utf8')) as { events: unknown[] };
      const events: AgentEvent[] = raw.events.map(decodeEvent);
      const first = events[0]; expect(first?.type).toBe('run_started');
      if (first?.type !== 'run_started') throw new Error('missing start');
      const model = new OfflineCartModel(); let state = initialState(first.task);
      for (const event of events) {
        if (event.type === 'model_requested') state = { ...state, iteration: event.iteration };
        if (event.type === 'decision_made') {
          const fake = await model.decide(state, new AbortController().signal);
          expect(fake).toEqual(event.decision);
          expect(decodeDecision(encodeDecision(event.decision))).toEqual(fake);
        }
        if (event.type === 'observation_added') state = addObservation(state, event.observation);
      }
      expect(replayAgentState([...events, ...events].reverse())).toEqual(state);
      expect(events.at(-1)).toMatchObject({ type: 'run_completed', status: 'complete' });
    }
  });
});
