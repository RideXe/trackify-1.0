/*
 * Copyright 2022 - 2026 Anton Tananaev (anton@trackify.org)
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
package org.trackify.session.cache;

import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.trackify.broadcast.BroadcastInterface;
import org.trackify.broadcast.BroadcastService;
import org.trackify.config.Config;
import org.trackify.config.Keys;
import org.trackify.helper.model.AttributeUtil;
import org.trackify.helper.model.PositionUtil;
import org.trackify.model.Attribute;
import org.trackify.model.BaseModel;
import org.trackify.model.Calendar;
import org.trackify.model.Device;
import org.trackify.model.Driver;
import org.trackify.model.Geofence;
import org.trackify.model.Group;
import org.trackify.model.GroupedModel;
import org.trackify.model.LinkedDevice;
import org.trackify.model.Maintenance;
import org.trackify.model.Notification;
import org.trackify.model.ObjectOperation;
import org.trackify.model.Permission;
import org.trackify.model.Position;
import org.trackify.model.Schedulable;
import org.trackify.model.Server;
import org.trackify.model.User;
import org.trackify.storage.Storage;
import org.trackify.storage.StorageException;
import org.trackify.storage.query.Columns;
import org.trackify.storage.query.Condition;
import org.trackify.storage.query.Request;

import java.util.Date;
import java.util.Deque;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.function.Supplier;
import java.util.stream.Collectors;

@Singleton
public class CacheManager implements BroadcastInterface {

    private static final Logger LOGGER = LoggerFactory.getLogger(CacheManager.class);

    private static final Set<Class<? extends BaseModel>> GROUPED_CLASSES =
            Set.of(Attribute.class, Device.class, Driver.class, Geofence.class, Maintenance.class, Notification.class);

    private final Config config;
    private final Storage storage;
    private final BroadcastService broadcastService;

    private final CacheGraph graph = new CacheGraph();

    private volatile Server server;
    private final Map<Long, ConcurrentLinkedDeque<Position>> devicePositions = new ConcurrentHashMap<>();
    private final Map<Long, HashSet<Object>> deviceReferences = new ConcurrentHashMap<>();

    @Inject
    public CacheManager(Config config, Storage storage, BroadcastService broadcastService) throws StorageException {
        this.config = config;
        this.storage = storage;
        this.broadcastService = broadcastService;
        server = storage.getObject(Server.class, new Request(new Columns.All()));
        broadcastService.registerListener(this);
    }

    @Override
    public String toString() {
        return graph.toString();
    }

    public Config getConfig() {
        return config;
    }

    public <T extends BaseModel> T getObject(Class<T> clazz, long id) {
        return graph.getObject(clazz, id);
    }

    public <T extends BaseModel> Set<T> getDeviceObjects(long deviceId, Class<T> clazz) {
        return graph.getObjects(Device.class, deviceId, clazz, Set.of(Group.class), true)
                .collect(Collectors.toUnmodifiableSet());
    }

    public Position getPosition(long deviceId) {
        var positions = devicePositions.get(deviceId);
        return positions != null ? positions.peekLast() : null;
    }

    public Deque<Position> getPositions(long deviceId) {
        return devicePositions.computeIfAbsent(deviceId, k -> new ConcurrentLinkedDeque<>());
    }

    public Server getServer() {
        return server;
    }

    public Set<User> getNotificationUsers(long notificationId, long deviceId) {
        Set<User> deviceUsers = getDeviceObjects(deviceId, User.class);
        return graph.getObjects(Notification.class, notificationId, User.class, Set.of(), false)
                .filter(deviceUsers::contains)
                .collect(Collectors.toUnmodifiableSet());
    }

    public Set<Notification> getDeviceNotifications(long deviceId) {
        var direct = graph.getObjects(Device.class, deviceId, Notification.class, Set.of(Group.class), true)
                .map(BaseModel::getId)
                .collect(Collectors.toUnmodifiableSet());
        return graph.getObjects(Device.class, deviceId, Notification.class, Set.of(Group.class, User.class), true)
                .filter(notification -> notification.getAlways() || direct.contains(notification.getId()))
                .collect(Collectors.toUnmodifiableSet());
    }

    public synchronized void addDevice(long deviceId, Object key) throws Exception {
        var references = deviceReferences.computeIfAbsent(deviceId, k -> new HashSet<>());
        if (references.isEmpty()) {
            Device device = storage.getObject(Device.class, new Request(
                    new Columns.All(), new Condition.Equals("id", deviceId)));
            graph.addObject(device);
            initializeCache(device);
            if (device.getPositionId() > 0) {
                Position position = storage.getObject(Position.class, new Request(
                        new Columns.All(),
                        new Condition.And(
                                new Condition.Equals("deviceId", deviceId),
                                new Condition.Equals("id", device.getPositionId()))));
                if (position != null) {
                    var positions = devicePositions.computeIfAbsent(deviceId, k -> new ConcurrentLinkedDeque<>());
                    if (config.getBoolean(Keys.REPORT_TRIP_NEW_LOGIC)) {
                        long minDuration = AttributeUtil.lookup(this, Keys.REPORT_TRIP_MIN_DURATION, deviceId) * 1000;
                        var from = new Date(position.getFixTime().getTime() - minDuration);
                        var to = position.getFixTime();
                        try (var positionsStream =
                                PositionUtil.getPositionsStreamWithExtra(storage, deviceId, from, to)) {
                            positionsStream.forEach(loaded -> appendPosition(positions, loaded));
                        }
                    } else {
                        positions.add(position);
                    }
                }
            }
        }
        references.add(key);
        LOGGER.debug("Cache add device {} references {} key {}", deviceId, references.size(), key);
    }

    public synchronized void removeDevice(long deviceId, Object key) {
        var references = deviceReferences.computeIfAbsent(deviceId, k -> new HashSet<>());
        references.remove(key);
        if (references.isEmpty()) {
            graph.removeObject(Device.class, deviceId);
            devicePositions.remove(deviceId);
            deviceReferences.remove(deviceId);
        }
        LOGGER.debug("Cache remove device {} references {} key {}", deviceId, references.size(), key);
    }

    private static boolean appendPosition(Deque<Position> positions, Position position) {
        Position previous = positions.peekLast();
        if (previous != null) {
            if (position.getFixTime().before(previous.getFixTime())) {
                return false;
            }
            if (position.getFixTime().equals(previous.getFixTime())) {
                if (position.getServerTime().before(previous.getServerTime())) {
                    return false;
                }
                positions.pollLast();
            }
        }
        positions.add(position);
        return true;
    }

    public void updatePosition(Position position) {
        deviceReferences.computeIfPresent(position.getDeviceId(), (key, oldValue) -> {
            var positions = devicePositions.computeIfAbsent(key, k -> new ConcurrentLinkedDeque<>());
            if (!appendPosition(positions, position)) {
                return oldValue;
            }
            if (config.getBoolean(Keys.REPORT_TRIP_NEW_LOGIC)) {
                long minDuration = AttributeUtil.lookup(
                        this, Keys.REPORT_TRIP_MIN_DURATION, key) * 1000;
                long lastTime = position.getFixTime().getTime();
                var iterator = positions.iterator();
                iterator.next();
                int toPrune = 0;
                while (iterator.hasNext() && lastTime - iterator.next().getFixTime().getTime() >= minDuration) {
                    toPrune += 1;
                }
                while (toPrune-- > 0) {
                    positions.poll();
                }
            } else {
                while (positions.size() > 1) {
                    positions.poll();
                }
            }
            return oldValue;
        });
    }

    @Override
    public <T extends BaseModel> void invalidateObject(
            boolean local, Class<T> clazz, long id, ObjectOperation operation) throws Exception {
        if (local) {
            broadcastService.invalidateObject(true, clazz, id, operation);
        }

        synchronized (this) {
            if (operation == ObjectOperation.DELETE) {
                graph.removeObject(clazz, id);
            }
            if (operation != ObjectOperation.UPDATE) {
                return;
            }

            if (clazz.equals(Server.class)) {
                server = storage.getObject(Server.class, new Request(new Columns.All()));
                return;
            }

            var after = storage.getObject(clazz, new Request(
                    new Columns.All(), new Condition.Equals("id", id)));
            if (after == null) {
                return;
            }
            var before = getObject(after.getClass(), after.getId());
            if (before == null) {
                return;
            }

            switch (after) {
                case GroupedModel afterGrouped -> {
                    long beforeGroupId = ((GroupedModel) before).getGroupId();
                    long afterGroupId = afterGrouped.getGroupId();
                    if (beforeGroupId != afterGroupId) {
                        if (beforeGroupId > 0) {
                            invalidatePermission(clazz, id, Group.class, beforeGroupId, false);
                        }
                        if (afterGroupId > 0) {
                            invalidatePermission(clazz, id, Group.class, afterGroupId, true);
                        }
                    }
                }
                case Schedulable afterSchedulable -> {
                    long beforeCalendarId = ((Schedulable) before).getCalendarId();
                    long afterCalendarId = afterSchedulable.getCalendarId();
                    if (beforeCalendarId != afterCalendarId) {
                        if (beforeCalendarId > 0) {
                            invalidatePermission(clazz, id, Calendar.class, beforeCalendarId, false);
                        }
                        if (afterCalendarId > 0) {
                            invalidatePermission(clazz, id, Calendar.class, afterCalendarId, true);
                        }
                    }
                }
                default -> {}
            }

            graph.updateObject(after);
        }
    }

    @Override
    public <T1 extends BaseModel, T2 extends BaseModel> void invalidatePermission(
            boolean local, Class<T1> clazz1, long id1, Class<T2> clazz2, long id2, boolean link) throws Exception {
        if (local) {
            broadcastService.invalidatePermission(true, clazz1, id1, clazz2, id2, link);
        }

        synchronized (this) {
            if (clazz1.equals(User.class) && GroupedModel.class.isAssignableFrom(clazz2)) {
                invalidatePermission(clazz2, id2, clazz1, id1, link);
            } else {
                invalidatePermission(clazz1, id1, clazz2, id2, link);
            }
        }
    }

    private void invalidatePermission(
            Class<? extends BaseModel> fromClass, long fromId,
            Class<? extends BaseModel> toClass, long toId, boolean link) throws Exception {

        if (toClass.equals(LinkedDevice.class)) {
            toClass = Device.class;
        }

        boolean groupLink = GroupedModel.class.isAssignableFrom(fromClass) && toClass.equals(Group.class);
        boolean calendarLink = Schedulable.class.isAssignableFrom(fromClass) && toClass.equals(Calendar.class);
        boolean userLink = fromClass.equals(User.class) && toClass.equals(Notification.class);

        boolean groupedLinks = GroupedModel.class.isAssignableFrom(fromClass)
                && (GROUPED_CLASSES.contains(toClass) || toClass.equals(User.class));

        if (!groupLink && !calendarLink && !userLink && !groupedLinks) {
            return;
        }

        if (link) {
            if (!graph.addLink(fromClass, fromId, toClass, toId, createObjectSupplier(toClass, toId))) {
                initializeCache(graph.getObject(toClass, toId));
            }
        } else {
            graph.removeLink(fromClass, fromId, toClass, toId);
        }
    }

    private void initializeCache(BaseModel object) throws Exception {
        if (object instanceof User) {
            for (Permission permission : storage.getPermissions(User.class, Notification.class)) {
                if (permission.getOwnerId() == object.getId()) {
                    invalidatePermission(
                            permission.getOwnerClass(), permission.getOwnerId(),
                            permission.getPropertyClass(), permission.getPropertyId(), true);
                }
            }
        } else {
            if (object instanceof GroupedModel groupedModel) {
                long groupId = groupedModel.getGroupId();
                if (groupId > 0) {
                    invalidatePermission(object.getClass(), object.getId(), Group.class, groupId, true);
                }

                for (Permission permission : storage.getPermissions(User.class, object.getClass())) {
                    if (permission.getPropertyId() == object.getId()) {
                        invalidatePermission(
                                object.getClass(), object.getId(), User.class, permission.getOwnerId(), true);
                    }
                }

                for (Class<? extends BaseModel> clazz : GROUPED_CLASSES) {
                    if (!clazz.equals(Device.class) || object.getClass().equals(Device.class)) {
                        for (Permission permission : storage.getPermissions(object.getClass(), clazz)) {
                            if (permission.getOwnerId() == object.getId()) {
                                invalidatePermission(
                                        object.getClass(), object.getId(),
                                        clazz, permission.getPropertyId(), true);
                            }
                        }
                    }
                }
            }

            if (object instanceof Schedulable schedulable) {
                long calendarId = schedulable.getCalendarId();
                if (calendarId > 0) {
                    invalidatePermission(object.getClass(), object.getId(), Calendar.class, calendarId, true);
                }
            }
        }
    }

    private <T> Supplier<T> createObjectSupplier(Class<T> clazz, long id) {
        return () -> {
            try {
                return storage.getObject(clazz, new Request(
                        new Columns.All(), new Condition.Equals("id", id)));
            } catch (StorageException e) {
                throw new RuntimeException(e);
            }
        };
    }

}
