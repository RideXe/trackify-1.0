/*
 * Copyright 2024 - 2025 Anton Tananaev (anton@trackify.org)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.trackify;

import com.google.inject.Injector;
import io.netty.channel.ChannelHandler;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInboundHandlerAdapter;
import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import org.trackify.config.Config;
import org.trackify.database.BufferingManager;
import org.trackify.database.NotificationManager;
import org.trackify.handler.BasePositionHandler;
import org.trackify.handler.ComputedAttributesHandler;
import org.trackify.handler.CopyAttributesHandler;
import org.trackify.handler.DatabaseHandler;
import org.trackify.handler.DistanceHandler;
import org.trackify.handler.DriverHandler;
import org.trackify.handler.EngineHoursHandler;
import org.trackify.handler.FilterHandler;
import org.trackify.handler.GeocoderHandler;
import org.trackify.handler.GeofenceHandler;
import org.trackify.handler.GeolocationHandler;
import org.trackify.handler.HemisphereHandler;
import org.trackify.handler.MapMatcherHandler;
import org.trackify.handler.MotionHandler;
import org.trackify.handler.OutdatedHandler;
import org.trackify.handler.PositionForwardingHandler;
import org.trackify.handler.PostProcessHandler;
import org.trackify.handler.SpeedLimitHandler;
import org.trackify.handler.TimeHandler;
import org.trackify.handler.events.AlarmEventHandler;
import org.trackify.handler.events.BaseEventHandler;
import org.trackify.handler.events.BehaviorEventHandler;
import org.trackify.handler.events.CommandResultEventHandler;
import org.trackify.handler.events.DriverEventHandler;
import org.trackify.handler.events.FuelEventHandler;
import org.trackify.handler.events.GeofenceEventHandler;
import org.trackify.handler.events.IgnitionEventHandler;
import org.trackify.handler.events.MaintenanceEventHandler;
import org.trackify.handler.events.MediaEventHandler;
import org.trackify.handler.events.MotionEventHandler;
import org.trackify.handler.events.OverspeedEventHandler;
import org.trackify.handler.events.ProximityEventHandler;
import org.trackify.handler.network.AcknowledgementHandler;
import org.trackify.helper.PositionLogger;
import org.trackify.model.Position;
import org.trackify.session.cache.CacheManager;

import java.util.HashMap;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Queue;
import java.util.stream.Stream;

@Singleton
@ChannelHandler.Sharable
public class ProcessingHandler extends ChannelInboundHandlerAdapter implements BufferingManager.Callback {

    private final CacheManager cacheManager;
    private final NotificationManager notificationManager;
    private final PositionLogger positionLogger;
    private final BufferingManager bufferingManager;
    private final List<BasePositionHandler> positionHandlers;
    private final List<BaseEventHandler> eventHandlers;
    private final PostProcessHandler postProcessHandler;

    private record QueuedPosition(ChannelHandlerContext ctx, Position position) {}

    private final Map<Long, Queue<QueuedPosition>> queues = new HashMap<>();

    private synchronized Queue<QueuedPosition> getQueue(long deviceId) {
        return queues.computeIfAbsent(deviceId, k -> new LinkedList<>());
    }

    @Inject
    public ProcessingHandler(
            Injector injector, Config config,
            CacheManager cacheManager, NotificationManager notificationManager, PositionLogger positionLogger) {
        this.cacheManager = cacheManager;
        this.notificationManager = notificationManager;
        this.positionLogger = positionLogger;
        bufferingManager = new BufferingManager(config, this);

        positionHandlers = Stream.of(
                ComputedAttributesHandler.Early.class,
                OutdatedHandler.class,
                TimeHandler.class,
                GeolocationHandler.class,
                HemisphereHandler.class,
                MapMatcherHandler.class,
                DistanceHandler.class,
                FilterHandler.class,
                GeofenceHandler.class,
                GeocoderHandler.class,
                SpeedLimitHandler.class,
                MotionHandler.class,
                ComputedAttributesHandler.Late.class,
                DriverHandler.class,
                CopyAttributesHandler.class,
                EngineHoursHandler.class,
                PositionForwardingHandler.class,
                DatabaseHandler.class)
                .map((clazz) -> (BasePositionHandler) injector.getInstance(clazz))
                .filter(Objects::nonNull)
                .toList();

        eventHandlers = Stream.of(
                MediaEventHandler.class,
                CommandResultEventHandler.class,
                OverspeedEventHandler.class,
                BehaviorEventHandler.class,
                FuelEventHandler.class,
                MotionEventHandler.class,
                GeofenceEventHandler.class,
                ProximityEventHandler.class,
                AlarmEventHandler.class,
                IgnitionEventHandler.class,
                MaintenanceEventHandler.class,
                DriverEventHandler.class)
                .map((clazz) -> (BaseEventHandler) injector.getInstance(clazz))
                .filter(Objects::nonNull)
                .toList();

        postProcessHandler = injector.getInstance(PostProcessHandler.class);
    }

    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) throws Exception {
        if (msg instanceof Position position) {
            cacheManager.addDevice(position.getDeviceId(), position);
            bufferingManager.accept(ctx, position);
        } else {
            super.channelRead(ctx, msg);
        }
    }

    @Override
    public void onReleased(ChannelHandlerContext context, Position position) {
        Queue<QueuedPosition> queue = getQueue(position.getDeviceId());
        boolean queued;
        synchronized (queue) {
            queued = !queue.isEmpty();
            queue.offer(new QueuedPosition(context, position));
        }
        if (!queued) {
            processPositionHandlers(context, position);
        }
    }

    private void processPositionHandlers(ChannelHandlerContext ctx, Position position) {
        var iterator = positionHandlers.iterator();
        iterator.next().handlePosition(position, new BasePositionHandler.Callback() {
            @Override
            public void processed(boolean filtered) {
                Runnable continuation = () -> {
                    if (!filtered) {
                        if (iterator.hasNext()) {
                            iterator.next().handlePosition(position, this);
                        } else {
                            processEventHandlers(ctx, position);
                        }
                    } else {
                        finishedProcessing(ctx, position, true);
                    }
                };
                if (ctx.executor().inEventLoop()) {
                    continuation.run();
                } else {
                    ctx.executor().execute(continuation);
                }
            }
        });
    }

    private void processEventHandlers(ChannelHandlerContext ctx, Position position) {
        eventHandlers.forEach(handler -> handler.analyzePosition(
                position, (event) -> notificationManager.updateEvents(Map.of(event, position))));
        finishedProcessing(ctx, position, false);
    }

    private void finishedProcessing(ChannelHandlerContext ctx, Position position, boolean filtered) {
        if (!filtered) {
            postProcessHandler.handlePosition(position, ignore -> {
                positionLogger.log(ctx, position);
                ctx.writeAndFlush(new AcknowledgementHandler.EventHandled(position));
                processNextPosition(position.getDeviceId());
            });
        } else {
            ctx.writeAndFlush(new AcknowledgementHandler.EventHandled(position));
            processNextPosition(position.getDeviceId());
        }
        cacheManager.removeDevice(position.getDeviceId(), position);
    }

    private void processNextPosition(long deviceId) {
        Queue<QueuedPosition> queue = getQueue(deviceId);
        QueuedPosition next;
        synchronized (queue) {
            queue.poll(); // remove current position
            next = queue.peek();
        }
        if (next != null) {
            next.ctx().executor().execute(() -> processPositionHandlers(next.ctx(), next.position()));
        }
    }

}
