export declare function checkMinecraftCoreReadiness(options: {
  instanceRoot: string
  minecraftVersion: string
  neoForgeVersion: string
}): Promise<any>

export declare function estimateCoreDownloadBytes(options: any): Promise<any>
export declare function buildCoreInstallPlan(options: any): Promise<any>
export declare function downloadAllCoreArtifacts(options: any): Promise<any>
export declare function installOrRepairMinecraftCore(options: any): Promise<any>
export declare function installNeoForgeFromPreparedInstaller(options: any): Promise<any>

export declare function resolveJavaRuntime(
  instanceRoot: string,
  options?: { isGui?: boolean; customPath?: string },
): {
  javaPath: string | null
  cliJavaPath: string | null
  isOfficialJdk: boolean
  error?: string
}

export declare function validateJavaBinary(
  javaCliPath: string,
  requiredMajor?: number,
  execRunner?: any,
): {
  valid: boolean
  major?: number | null
  error?: string
}

export declare function parseJavaMajorVersion(output: string): number | null
export declare function ensureJava21Runtime(options?: any): Promise<any>
export declare function getJavaRuntimeDir(root?: string): string
export declare function normalizeNeoForgeProfileVersion(raw: string): string
export declare function validateFileIntegrity(filePath: string, expectedSize?: number, expectedSha1?: string): Promise<boolean>
export declare function validateFileSha256(filePath: string, expectedSize?: number, expectedSha256?: string): Promise<boolean>
export declare function calculateFileSha1(filePath: string): Promise<string>
export declare function calculateFileSha256(filePath: string): Promise<string>
export declare function bootstrapNeoForgeInstaller(options: any): Promise<any>
export declare function getPlannerCachePaths(instanceRoot: string, neoForgeVersion: string): any
export declare function loadPlannerInstallerMetadata(cacheDir: string): Promise<any>
export declare function savePlannerInstallerMetadata(cacheDir: string, metadata: any): Promise<void>
export declare function validatePlannerInstaller(cacheDir: string, expectedSha256: string): Promise<boolean>
export declare function ensurePlannerInstaller(options: any): Promise<any>
export declare function promotePlannerInstallerToCanonical(instanceRoot: string, neoForgeVersion: string): Promise<string>
export declare function resolveOfficialNeoForgeInstallerSha256(neoForgeVersion: string, customFetch?: any): Promise<string | null>
export declare function fetchOfficialNeoForgeInstallerSha256(neoForgeVersion: string, customFetch?: any): Promise<string | null>
export declare function readInstallProfileFromJar(jarPath: string): Promise<any>
export declare function canonicalNeoForgeInstallerPath(instanceRoot: string, neoForgeVersion: string): string
export declare function getNeoForgeInstallerJarPath(instanceRoot: string, neoForgeVersion: string): string
export declare function getNeoForgeProfileCandidates(minecraftVersion: string, neoForgeVersion: string): string[]
export declare function loadCoreState(instanceRoot: string): Promise<any>
export declare function saveCoreState(instanceRoot: string, state: any): Promise<void>
export declare function getCurrentPlatformOsKey(): string
