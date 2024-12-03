import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GlobalExceptionsFilter } from './common/filters/global-exceptions.filter';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { TelegramService } from './telegram/telegram.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const httpAdapter = app.get(HttpAdapterHost);

  app.useGlobalFilters(new GlobalExceptionsFilter(httpAdapter));

  app.useGlobalInterceptors(new TimeoutInterceptor(5000));

  const telegramService = app.get(TelegramService);

  if (process.env.NODE_ENV === 'production') {
    const webhookUrl = `${process.env.NGROK}/telegram/webhook`;
    await telegramService.setWebhook(webhookUrl);
  }

  await app.listen(process.env.API_PORT ?? 8888);
}
bootstrap();
