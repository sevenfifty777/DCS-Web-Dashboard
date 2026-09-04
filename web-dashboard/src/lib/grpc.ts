import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

const PROTO_PATH = path.resolve(process.cwd(), 'protos');
const LOADER_OPTIONS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [PROTO_PATH],
};
const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT || 'localhost:50051';
const credentials = grpc.credentials.createInsecure();

type DynamicClient = InstanceType<grpc.ServiceClientConstructor>;
type UnaryMethod<TResponse> = (
  request: object,
  callback: grpc.requestCallback<TResponse>,
) => grpc.ClientUnaryCall;
type ServerStreamingMethod<TResponse> = (
  request: object,
) => grpc.ClientReadableStream<TResponse>;

export interface HealthResponse {
  alive: boolean;
}

export interface VersionResponse {
  version: string;
}

export interface MissionNameResponse {
  name: string;
}

export interface PausedResponse {
  paused: boolean;
}

export interface EvalResponse {
  json: string;
}

export interface PlayerInfo {
  id: number;
  name: string;
  coalition: string;
  slot: string;
  ping: number;
  remote_address: string;
  ucid: string;
  locale: string;
}

export interface PlayersResponse {
  players: PlayerInfo[];
}

export interface UserFlagResponse {
  value: number;
}

function loadService(protoPath: string, servicePath: string[]): grpc.ServiceClientConstructor {
  const definition = protoLoader.loadSync(path.join(PROTO_PATH, protoPath), LOADER_OPTIONS);
  let current: grpc.GrpcObject | grpc.ServiceClientConstructor | grpc.ProtobufTypeDefinition =
    grpc.loadPackageDefinition(definition);

  for (const segment of servicePath) {
    if (typeof current !== 'object' || current === null || 'format' in current) {
      throw new Error(`Invalid gRPC service path: ${servicePath.join('.')}`);
    }
    const nextNode: grpc.GrpcObject | grpc.ServiceClientConstructor | grpc.ProtobufTypeDefinition
      | undefined = current[segment];
    if (!nextNode) throw new Error(`Missing gRPC service path: ${servicePath.join('.')}`);
    current = nextNode;
  }

  if (typeof current !== 'function') {
    throw new Error(`gRPC service is not constructable: ${servicePath.join('.')}`);
  }
  return current;
}

function createClient(protoPath: string, servicePath: string[]): DynamicClient {
  const Service = loadService(protoPath, servicePath);
  return new Service(GRPC_ENDPOINT, credentials);
}

function unaryRequest<TResponse>(
  client: DynamicClient,
  methodName: string,
  request: object,
): Promise<TResponse> {
  const candidate = (client as unknown as Record<string, unknown>)[methodName];
  if (typeof candidate !== 'function') {
    return Promise.reject(new Error(`gRPC method is unavailable: ${methodName}`));
  }
  const method = candidate as UnaryMethod<TResponse>;

  return new Promise((resolve, reject) => {
    method.call(client, request, (error, response) => {
      if (error) reject(error);
      else if (response === undefined) reject(new Error(`gRPC method returned no response: ${methodName}`));
      else resolve(response);
    });
  });
}

function serverStreamingRequest<TResponse>(
  client: DynamicClient,
  methodName: string,
  request: object,
): grpc.ClientReadableStream<TResponse> {
  const candidate = (client as unknown as Record<string, unknown>)[methodName];
  if (typeof candidate !== 'function') {
    throw new Error(`gRPC method is unavailable: ${methodName}`);
  }
  return (candidate as ServerStreamingMethod<TResponse>).call(client, request);
}

export const metadataClient = createClient(
  'dcs/metadata/v0/metadata.proto',
  ['dcs', 'metadata', 'v0', 'MetadataService'],
);
export const hookClient = createClient(
  'dcs/hook/v0/hook.proto',
  ['dcs', 'hook', 'v0', 'HookService'],
);
export const netClient = createClient(
  'dcs/net/v0/net.proto',
  ['dcs', 'net', 'v0', 'NetService'],
);
export const missionClient = createClient(
  'dcs/mission/v0/mission.proto',
  ['dcs', 'mission', 'v0', 'MissionService'],
);
export const triggerClient = createClient(
  'dcs/trigger/v0/trigger.proto',
  ['dcs', 'trigger', 'v0', 'TriggerService'],
);
export const customClient = createClient(
  'dcs/custom/v0/custom.proto',
  ['dcs', 'custom', 'v0', 'CustomService'],
);

export const getHealth = (): Promise<HealthResponse> =>
  unaryRequest(metadataClient, 'GetHealth', {});
export const getVersion = (): Promise<VersionResponse> =>
  unaryRequest(metadataClient, 'GetVersion', {});

export const getMissionName = (): Promise<MissionNameResponse> =>
  unaryRequest(hookClient, 'GetMissionName', {});
export const getPaused = (): Promise<PausedResponse> =>
  unaryRequest(hookClient, 'GetPaused', {});
export const setPaused = (paused: boolean): Promise<Record<string, never>> =>
  unaryRequest(hookClient, 'SetPaused', { paused });
export const stopMission = (): Promise<Record<string, never>> =>
  unaryRequest(hookClient, 'StopMission', {});
export const reloadCurrentMission = (): Promise<Record<string, never>> =>
  unaryRequest(hookClient, 'ReloadCurrentMission', {});
export const loadMission = (fileName: string): Promise<Record<string, never>> =>
  unaryRequest(hookClient, 'LoadMission', { file_name: fileName });
export const hookEval = (lua: string): Promise<EvalResponse> =>
  unaryRequest(hookClient, 'Eval', { lua });

export const getPlayers = (): Promise<PlayersResponse> =>
  unaryRequest(netClient, 'GetPlayers', {});
export const sendChat = (
  message: string,
  coalition = 'COALITION_ALL',
): Promise<Record<string, never>> =>
  unaryRequest(netClient, 'SendChat', { message, coalition });

export const getUserFlag = (flag: string): Promise<UserFlagResponse> =>
  unaryRequest(triggerClient, 'GetUserFlag', { flag });
export const setUserFlag = (flag: string, value: number): Promise<Record<string, never>> =>
  unaryRequest(triggerClient, 'SetUserFlag', { flag, value });

export const customEval = (lua: string): Promise<EvalResponse> =>
  unaryRequest(customClient, 'Eval', { lua });

export const streamMissionEvents = (): grpc.ClientReadableStream<unknown> =>
  serverStreamingRequest(missionClient, 'StreamEvents', {});
export const streamUnits = (
  category: string,
): grpc.ClientReadableStream<unknown> =>
  serverStreamingRequest(missionClient, 'StreamUnits', {
    poll_rate: 1,
    max_backoff: 1,
    category,
  });
