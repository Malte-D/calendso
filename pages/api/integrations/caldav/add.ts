import type { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "next-auth/client";
import prisma from "../../../../lib/prisma";
import { symmetricEncrypt } from "@lib/crypto";
import logger from "@lib/logger";
import { davRequest, getBasicAuthHeaders } from "tsdav";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "POST") {
    // Check that user is authenticated
    const session = await getSession({ req: req });

    if (!session) {
      res.status(401).json({ message: "You must be logged in to do this" });
      return;
    }

    const { username, password, url } = req.body;
    // Get user
    await prisma.user.findFirst({
      where: {
        email: session.user.email,
      },
      select: {
        id: true,
      },
    });

    const header = getBasicAuthHeaders({
      username,
      password,
    });

    try {
      const [response] = await davRequest({
        url: url,
        init: {
          method: "PROPFIND",
          namespace: "d",
          body: {
            propfind: {
              _attributes: {
                "xmlns:d": "DAV:",
              },
              prop: { "d:current-user-principal": {} },
            },
          },
          headers: header,
        },
      });

      if (!response.ok) {
        logger.error("Could not add this caldav account", response?.statusText);
        logger.error(response.error);
        return res.status(200).json({ message: "Could not add this caldav account" });
      }

      if (response.ok) {
        await prisma.credential.create({
          data: {
            type: "caldav_calendar",
            key: symmetricEncrypt(
              JSON.stringify({ username, password, url }),
              process.env.CALENDSO_ENCRYPTION_KEY
            ),
            userId: session.user.id,
          },
        });
      }
    } catch (reason) {
      logger.error("Could not add this caldav account", reason);
      return res.status(200).json({ message: "Could not add this caldav account" });
    }
    // TODO VALIDATE URL
    // TODO VALIDATE CONNECTION IS POSSIBLE

    return res.status(200).json({});
  }
}