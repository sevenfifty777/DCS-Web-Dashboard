export const SRS_CLIENTS_UNAVAILABLE_MESSAGE =
  'Connected-client data is temporarily unavailable. Please try again shortly.';

export interface SrsRadio {
  freq: number;
}

export interface SrsClient {
  Name: string;
  UnitType: string;
  Coalition: number;
  RadioInfo: {
    radios: SrsRadio[];
  };
}

export interface SrsClientsResponse {
  Clients: SrsClient[];
  ServerVersion?: string;
}

export interface SrsClientsState {
  clients: SrsClient[];
  error: string;
  hasSuccessfulResult: boolean;
}

export type SrsClientsAction =
  | { type: 'success'; clients: SrsClient[] }
  | { type: 'failure'; message: string };

export const INITIAL_SRS_CLIENTS_STATE: SrsClientsState = {
  clients: [],
  error: '',
  hasSuccessfulResult: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSrsRadio(value: unknown): value is SrsRadio {
  return isRecord(value) && typeof value.freq === 'number' && Number.isFinite(value.freq);
}

function isSrsClient(value: unknown): value is SrsClient {
  if (!isRecord(value) || !isRecord(value.RadioInfo)) return false;

  return (
    typeof value.Name === 'string'
    && typeof value.UnitType === 'string'
    && typeof value.Coalition === 'number'
    && Array.isArray(value.RadioInfo.radios)
    && value.RadioInfo.radios.every(isSrsRadio)
  );
}

export function parseSrsClientsResponse(value: unknown): SrsClientsResponse | null {
  if (!isRecord(value) || !Array.isArray(value.Clients) || !value.Clients.every(isSrsClient)) {
    return null;
  }
  if (value.ServerVersion !== undefined && typeof value.ServerVersion !== 'string') {
    return null;
  }

  return {
    Clients: value.Clients,
    ServerVersion: value.ServerVersion,
  };
}

export function hasApiError(value: unknown): boolean {
  return isRecord(value) && typeof value.error === 'string';
}

export function reduceSrsClientsState(
  state: SrsClientsState,
  action: SrsClientsAction,
): SrsClientsState {
  if (action.type === 'success') {
    return {
      clients: action.clients,
      error: '',
      hasSuccessfulResult: true,
    };
  }

  return {
    ...state,
    error: action.message,
  };
}
