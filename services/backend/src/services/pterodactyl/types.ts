/**
 * Pterodactyl Client API types & data structures (Internal to Backend)
 */

export interface PterodactylServerLimits {
  memory: number // MB (0 = unlimited)
  swap: number
  disk: number // MB (0 = unlimited)
  io: number
  cpu: number // % limit (0 = unlimited)
  threads: string | null
}

export interface PterodactylServerAttributes {
  server_owner: boolean
  identifier: string
  uuid: string
  name: string
  node: string
  is_suspended: boolean
  limits: PterodactylServerLimits
}

export interface PterodactylServerResponse {
  object: "server"
  attributes: PterodactylServerAttributes
}

export interface PterodactylStatsResources {
  memory_bytes: number
  cpu_absolute: number
  disk_bytes: number
  network_rx_bytes: number
  network_tx_bytes: number
  uptime: number // milliseconds
}

export interface PterodactylStatsAttributes {
  current_state: "running" | "starting" | "stopping" | "offline"
  is_suspended: boolean
  resources: PterodactylStatsResources
}

export interface PterodactylStatsResponse {
  object: "stats"
  attributes: PterodactylStatsAttributes
}

export interface PterodactylWebsocketData {
  token: string
  socket: string
}

export interface PterodactylWebsocketResponse {
  data: PterodactylWebsocketData
}

export interface PterodactylBackupAttributes {
  uuid: string
  is_successful: boolean
  is_locked: boolean
  name: string
  ignored_files: string[]
  sha256_hash: string | null
  bytes: number
  created_at: string
  completed_at: string | null
}

export interface PterodactylBackupResponse {
  object: "backup"
  attributes: PterodactylBackupAttributes
}

export interface PterodactylBackupListResponse {
  object: "list"
  data: PterodactylBackupResponse[]
  meta?: {
    pagination?: {
      total: number
      count: number
      per_page: number
      current_page: number
      total_pages: number
    }
  }
}

export interface PterodactylSignedUrlResponse {
  object: "signed_url"
  attributes: {
    url: string
  }
}

export interface PterodactylFileAttributes {
  name: string
  mode: string
  mode_bits: string
  size: number
  is_file: boolean
  is_symlink: boolean
  mimetype: string
  created_at: string
  modified_at: string
}

export interface PterodactylFileResponse {
  object: "file_object"
  attributes: PterodactylFileAttributes
}

export interface PterodactylFileListResponse {
  object: "list"
  data: PterodactylFileResponse[]
}

export interface PterodactylScheduleTaskAttributes {
  id: number
  sequence_id: number
  action: "power" | "command" | "backup"
  payload: string
  time_offset: number
  is_queued: boolean
  continue_on_failure: boolean
  created_at?: string
  updated_at?: string
}

export interface PterodactylScheduleAttributes {
  id: number
  name: string
  cron: {
    day_of_week: string
    month: string
    day_of_month: string
    hour: string
    minute: string
  }
  is_active: boolean
  is_processing: boolean
  only_when_online: boolean
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
  tasks: Array<{
    object: "schedule_task"
    attributes: PterodactylScheduleTaskAttributes
  }>
}

export interface PterodactylScheduleResponse {
  object: "server_schedule"
  attributes: PterodactylScheduleAttributes
}

export interface PterodactylScheduleListResponse {
  object: "list"
  data: PterodactylScheduleResponse[]
}

export interface PterodactylActivityAttributes {
  id?: string
  event: string
  is_api: boolean
  ip?: string
  description?: string
  timestamp: string
}

export interface PterodactylActivityResponse {
  object: "activity_log"
  attributes: PterodactylActivityAttributes
}

export interface PterodactylActivityListResponse {
  object: "list"
  data: PterodactylActivityResponse[]
}

export interface CreateScheduleInput {
  name: string
  is_active?: boolean
  minute: string
  hour: string
  day_of_month: string
  month: string
  day_of_week: string
  only_when_online?: boolean
}

export interface CreateScheduleTaskInput {
  action: "power" | "command" | "backup"
  payload: string
  time_offset?: number
  continue_on_failure?: boolean
}

export interface UpdateScheduleTaskInput {
  action: "power" | "command" | "backup"
  payload: string
  time_offset?: number
  continue_on_failure?: boolean
}

export interface IPterodactylClient {
  getServerDetails(): Promise<PterodactylServerResponse>
  getServerResources(): Promise<PterodactylStatsResponse>
  sendPowerAction(signal: "start" | "stop" | "restart" | "kill"): Promise<void>
  sendCommand(command: string): Promise<void>
  getWebsocketCredentials(): Promise<PterodactylWebsocketData>

  // Backups
  listBackups(): Promise<PterodactylBackupListResponse>
  getBackup(uuid: string): Promise<PterodactylBackupResponse>
  createBackup(name?: string, isLocked?: boolean): Promise<PterodactylBackupResponse>
  getBackupDownload(uuid: string): Promise<PterodactylSignedUrlResponse>
  restoreBackup(uuid: string, truncate?: boolean): Promise<void>
  deleteBackup(uuid: string): Promise<void>
  toggleBackupLock(uuid: string): Promise<PterodactylBackupResponse>

  // Files
  listDirectory(directory?: string): Promise<PterodactylFileListResponse>
  getFileContents(filePath: string): Promise<string>
  getFileDownload(filePath: string): Promise<PterodactylSignedUrlResponse>
  getFileUploadUrl(): Promise<PterodactylSignedUrlResponse>
  renameFile(root: string, from: string, to: string): Promise<void>
  writeFile(filePath: string, content: string): Promise<void>
  createFolder(root: string, name: string): Promise<void>
  deleteFiles(root: string, files: string[]): Promise<void>
  compressFiles(root: string, files: string[]): Promise<PterodactylFileResponse>
  decompressFile(root: string, file: string): Promise<void>

  // Schedules
  listSchedules(): Promise<PterodactylScheduleListResponse>
  getSchedule(id: number | string): Promise<PterodactylScheduleResponse>
  createSchedule(payload: CreateScheduleInput): Promise<PterodactylScheduleResponse>
  updateSchedule(id: number | string, payload: Partial<CreateScheduleInput>): Promise<PterodactylScheduleResponse>
  executeSchedule(id: number | string): Promise<void>
  deleteSchedule(id: number | string): Promise<void>
  createScheduleTask(scheduleId: number | string, taskPayload: CreateScheduleTaskInput): Promise<void>
  updateScheduleTask(scheduleId: number | string, taskId: number | string, taskPayload: UpdateScheduleTaskInput): Promise<void>
  deleteScheduleTask(scheduleId: number | string, taskId: number | string): Promise<void>

  // Activity
  getServerActivity(): Promise<PterodactylActivityListResponse>
}
