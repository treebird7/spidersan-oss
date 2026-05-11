import type { Branch } from './adapter.js';
import type {
    CrossMachineConflict,
    MachineIdentity,
    MachineRegistryView,
    RegistryStatus,
    RegistrySyncResult,
} from '../types/cloud.js';

export interface SupabaseRegistrySyncClient {
    push(
        machine: MachineIdentity,
        repoName: string,
        repoPath: string,
        branches: Branch[],
    ): Promise<RegistrySyncResult>;
    pull(repoName: string, excludeMachine?: string): Promise<MachineRegistryView[]>;
    getStatus(repoName?: string): Promise<RegistryStatus[]>;
    detectCrossMachineConflicts(
        repoName: string,
        excludeMachine?: string,
    ): Promise<CrossMachineConflict[]>;
}
