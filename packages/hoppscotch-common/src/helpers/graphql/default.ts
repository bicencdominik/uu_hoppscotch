import { parse, print } from "graphql"
import { HoppGQLRequest, GQL_REQ_SCHEMA_VERSION } from "@hoppscotch/data"

const DEFAULT_QUERY = print(
  parse(
    `
      query Request {
        method
        url
        headers {
          key
          value
        }
      }
    `,
    { allowLegacyFragmentVariables: true }
  )
)

export const getDefaultGQLRequest = (): HoppGQLRequest => ({
  v: GQL_REQ_SCHEMA_VERSION,
  name: "Untitled",
  // Blank for the air-gapped build; see hoppscotch-common/src/helpers/rest/default.ts.
  url: "",
  headers: [],
  variables: `{
  "id": "1"
}`,
  query: DEFAULT_QUERY,
  auth: {
    authType: "inherit",
    authActive: true,
  },
})
