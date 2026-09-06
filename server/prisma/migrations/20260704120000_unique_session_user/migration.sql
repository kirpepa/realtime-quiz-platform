CREATE UNIQUE INDEX "SessionParticipant_sessionId_userId_key"
ON "SessionParticipant"("sessionId", "userId");
