/*
 * Copyright 2016 - 2026 Anton Tananaev (anton@trackify.org)
 * Copyright 2016 Andrey Kunitsyn (andrey@trackify.org)
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
package org.trackify.reports;

import org.apache.poi.ss.util.WorkbookUtil;
import org.trackify.config.Config;
import org.trackify.config.Keys;
import org.trackify.helper.model.DeviceUtil;
import org.trackify.helper.model.PositionUtil;
import org.trackify.model.Device;
import org.trackify.model.Group;
import org.trackify.model.Position;
import org.trackify.reports.common.ReportUtils;
import org.trackify.reports.model.DeviceReportSection;
import org.trackify.storage.Storage;
import org.trackify.storage.StorageException;
import org.trackify.storage.query.Columns;
import org.trackify.storage.query.Condition;
import org.trackify.storage.query.Request;

import jakarta.inject.Inject;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.Map;
import java.util.HashMap;
import java.util.stream.Stream;

public class RouteReportProvider {

    private final Config config;
    private final ReportUtils reportUtils;
    private final Storage storage;

    private final Map<String, Integer> namesCount = new HashMap<>();

    @Inject
    public RouteReportProvider(Config config, ReportUtils reportUtils, Storage storage) {
        this.config = config;
        this.reportUtils = reportUtils;
        this.storage = storage;
    }

    public Stream<Position> getObjects(long userId, Collection<Long> deviceIds, Collection<Long> groupIds,
            Date from, Date to) throws StorageException {
        reportUtils.checkPeriodLimit(from, to);

        return DeviceUtil.getAccessibleDevices(storage, userId, deviceIds, groupIds).stream()
                .flatMap(device -> {
                    try {
                        return PositionUtil.getPositionsStream(storage, device.getId(), from, to);
                    } catch (StorageException e) {
                        throw new RuntimeException(e);
                    }
                });
    }


    private String getUniqueSheetName(String key) {
        namesCount.compute(key, (k, value) -> value == null ? 1 : (value + 1));
        return namesCount.get(key) > 1 ? key + '-' + namesCount.get(key) : key;
    }

    public void getExcel(OutputStream outputStream,
            long userId, Collection<Long> deviceIds, Collection<Long> groupIds,
            Date from, Date to) throws StorageException, IOException {
        reportUtils.checkPeriodLimit(from, to);

        ArrayList<DeviceReportSection> devicesRoutes = new ArrayList<>();
        ArrayList<String> sheetNames = new ArrayList<>();
        for (Device device: DeviceUtil.getAccessibleDevices(storage, userId, deviceIds, groupIds)) {
            var positions = PositionUtil.getPositions(storage, device.getId(), from, to);
            DeviceReportSection deviceRoutes = new DeviceReportSection();
            deviceRoutes.setDeviceName(device.getName());
            sheetNames.add(WorkbookUtil.createSafeSheetName(getUniqueSheetName(deviceRoutes.getDeviceName())));
            if (device.getGroupId() > 0) {
                Group group = storage.getObject(Group.class, new Request(
                        new Columns.All(), new Condition.Equals("id", device.getGroupId())));
                if (group != null) {
                    deviceRoutes.setGroupName(group.getName());
                }
            }
            deviceRoutes.setObjects(positions);
            devicesRoutes.add(deviceRoutes);
        }

        File file = Paths.get(config.getString(Keys.TEMPLATES_ROOT), "export", "route.xlsx").toFile();
        try (InputStream inputStream = new FileInputStream(file)) {
            var context = reportUtils.initializeContext(userId);
            context.putVar("devices", devicesRoutes);
            context.putVar("sheetNames", sheetNames);
            context.putVar("from", from);
            context.putVar("to", to);
            reportUtils.processTemplateWithSheets(inputStream, outputStream, context);
        }
    }
}
