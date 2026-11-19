import { z } from 'zod';

const feedbackRatingValues = ['UP', 'DOWN'] as const;

export const feedbackOrganizationHeaderSchema = z.object({
  'x-organization-id': z.string().uuid(),
});

export const feedbackParamsSchema = z.object({
  id: z.string().uuid(),
});

export const submitFeedbackBodySchema = z.object({
  rating: z.enum(feedbackRatingValues),
  comment: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined || value === null || value.length === 0) {
        return null;
      }
      return value;
    }),
});

export const messageFeedbackSchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
  userId: z.string().uuid(),
  rating: z.enum(feedbackRatingValues),
  comment: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const submitFeedbackResponseSchema = z.object({
  feedback: messageFeedbackSchema,
});
