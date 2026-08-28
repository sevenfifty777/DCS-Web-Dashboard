import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INITIAL_SRS_CLIENTS_STATE,
  parseSrsClientsResponse,
  reduceSrsClientsState,
  type SrsClient,
} from './srsState.ts';

const client: SrsClient = {
  Name: 'Apex',
  UnitType: 'FA-18C_hornet',
  Coalition: 2,
  RadioInfo: { radios: [{ freq: 251_000_000 }] },
};

test('should_accept_a_valid_clients_response', () => {
  assert.deepEqual(parseSrsClientsResponse({ Clients: [client], ServerVersion: '2.3.1' }), {
    Clients: [client],
    ServerVersion: '2.3.1',
  });
});

test('should_reject_a_malformed_clients_response', () => {
  assert.equal(parseSrsClientsResponse({ Clients: [{ ...client, Coalition: 'blue' }] }), null);
});

test('should_preserve_the_last_successful_clients_when_a_poll_fails', () => {
  const loaded = reduceSrsClientsState(INITIAL_SRS_CLIENTS_STATE, {
    type: 'success',
    clients: [client],
  });
  const failed = reduceSrsClientsState(loaded, {
    type: 'failure',
    message: 'Temporarily unavailable',
  });

  assert.deepEqual(failed.clients, [client]);
  assert.equal(failed.error, 'Temporarily unavailable');
  assert.equal(failed.hasSuccessfulResult, true);
});

test('should_clear_only_the_client_error_when_a_later_poll_succeeds', () => {
  const failed = reduceSrsClientsState(INITIAL_SRS_CLIENTS_STATE, {
    type: 'failure',
    message: 'Temporarily unavailable',
  });
  const recovered = reduceSrsClientsState(failed, { type: 'success', clients: [client] });

  assert.equal(recovered.error, '');
  assert.deepEqual(recovered.clients, [client]);
  assert.equal(recovered.hasSuccessfulResult, true);
});
