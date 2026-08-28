import { runMutation } from "@helpers/backend/GQLClient"
import axios from "axios"
import * as E from "fp-ts/Either"
import { z } from "zod"
import {
  UpdateUserDisplayNameDocument,
  UpdateUserDisplayNameMutation,
  UpdateUserDisplayNameMutationVariables,
} from "@app/api/generated/graphql"

const expectedAllowedProvidersSchema = z.object({
  // currently supported values are "GOOGLE", "GITHUB", "EMAIL", "MICROSOFT", "SAML"
  // keeping it as string to avoid backend accidentally breaking frontend when adding new providers
  providers: z.array(z.string()),
})

export const getAllowedAuthProviders = async () => {
  try {
    const res = await axios.get(
      `${import.meta.env.VITE_BACKEND_API_URL}/auth/providers`,
      {
        withCredentials: true,
      }
    )

    const parseResult = expectedAllowedProvidersSchema.safeParse(res.data)

    if (!parseResult.success) {
      return E.left("SOMETHING_WENT_WRONG")
    }

    return E.right(parseResult.data.providers)
  } catch (_) {
    return E.left("SOMETHING_WENT_WRONG")
  }
}

/**
 * Sign in with a local username and password.
 *
 * Resolves with the backend's error code on failure rather than throwing, so the
 * caller can map it to a message. The backend deliberately returns the same code
 * for "no such user" and "wrong password" -- do not try to tell them apart here.
 */
export const signInWithPassword = async (
  username: string,
  password: string
) => {
  try {
    await axios.post(
      `${import.meta.env.VITE_BACKEND_API_URL}/auth/signin/password`,
      { username, password },
      { withCredentials: true }
    )

    return E.right(undefined)
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // The throttler replies 429 with its own message shape, so key off the
      // status rather than the body.
      if (error.response?.status === 429) return E.left("TOO_MANY_ATTEMPTS")

      const message = error.response?.data?.message
      if (typeof message === "string") return E.left(message)
    }

    return E.left("SOMETHING_WENT_WRONG")
  }
}

export const updateUserDisplayName = (updatedDisplayName: string) =>
  runMutation<
    UpdateUserDisplayNameMutation,
    UpdateUserDisplayNameMutationVariables,
    ""
  >(UpdateUserDisplayNameDocument, {
    updatedDisplayName,
  })()
