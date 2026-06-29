/*
 * Copyright 2024 Anton Tananaev (anton@trackify.org)
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

import jakarta.inject.Inject;
import org.jxls.util.JxlsHelper;
import org.trackify.config.Config;
import org.trackify.config.Keys;
import org.trackify.helper.model.PositionUtil;
import org.trackify.model.Device;
import org.trackify.model.Message;
import org.trackify.model.User;
import org.trackify.reports.common.ReportUtils;
import org.trackify.reports.model.DeviceReportItem;
import org.trackify.storage.Storage;
import org.trackify.storage.StorageException;
import org.trackify.storage.query.Columns;
import org.trackify.storage.query.Condition;
import org.trackify.storage.query.Request;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Paths;
import java.util.Collection;
import java.util.stream.Collectors;

public class DevicesReportProvider {

    private final Config config;
    private final ReportUtils reportUtils;
    private final Storage storage;

    @Inject
    public DevicesReportProvider(Config config, ReportUtils reportUtils, Storage storage) {
        this.config = config;
        this.reportUtils = reportUtils;
        this.storage = storage;
    }

    public Collection<DeviceReportItem> getObjects(long userId) throws StorageException {

        var positions = PositionUtil.getLatestPositions(storage, userId).stream()
                .collect(Collectors.toMap(Message::getDeviceId, p -> p));

        return storage.getObjects(Device.class, new Request(
                new Columns.All(),
                new Condition.Permission(User.class, userId, Device.class))).stream()
                .map(device -> new DeviceReportItem(device, positions.get(device.getId())))
                .toList();
    }

    public void getExcel(OutputStream outputStream, long userId) throws StorageException, IOException {

        File file = Paths.get(config.getString(Keys.TEMPLATES_ROOT), "export", "devices.xlsx").toFile();
        try (InputStream inputStream = new FileInputStream(file)) {
            var context = reportUtils.initializeContext(userId);
            context.putVar("items", getObjects(userId));
            JxlsHelper.getInstance().setUseFastFormulaProcessor(false)
                    .processTemplate(inputStream, outputStream, context);
        }
    }
}
