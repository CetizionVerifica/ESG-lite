import { getChannel } from "../config/rabbitmq";
import {EmailJob} from "../types/email";

export const sendToQueue = async (data: EmailJob) => {
    const channel = getChannel();

    channel.sendToQueue(
        "email_queue",
        Buffer.from(JSON.stringify({ ...data, retryCount: 0 })),
        { persistent: true }
    );
};
