import { HoppRESTRequest, RESTReqSchemaVersion } from "@hoppscotch/data"

export const getDefaultRESTRequest = (): HoppRESTRequest => ({
  v: RESTReqSchemaVersion,
  // Blank rather than echo.hoppscotch.io: on an isolated network the seeded
  // default would hang on a new user's very first Send, which reads as "the app
  // is broken" instead of "that host is unreachable".
  endpoint: "",
  name: "Untitled",
  params: [],
  headers: [],
  method: "GET",
  auth: {
    authType: "inherit",
    authActive: true,
  },
  preRequestScript: "",
  testScript: "",
  body: {
    contentType: null,
    body: null,
  },
  requestVariables: [],
  responses: {},
  description: null,
})
