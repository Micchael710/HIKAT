import { commonTypeDefs } from "./common"

import { userTypeDefs } from "./user"

import { healthTypeDefs } from "./health"

import { adminTypeDefs } from "./admin"

import { contentTypeDefs } from "./content"

import { serverTypeDefs } from "./server"

export * from "./common"

export * from "./user"

export * from "./health"

export * from "./admin"

export * from "./content"

export * from "./server"

export const typeDefs = [
  commonTypeDefs,

  healthTypeDefs,

  userTypeDefs,

  adminTypeDefs,

  contentTypeDefs,

  serverTypeDefs,
].join("\n\n")

