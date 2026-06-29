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
package org.trackify.reports;

import org.trackify.helper.model.PositionUtil;
import org.trackify.model.Device;
import org.trackify.model.Geofence;
import org.trackify.model.Position;
import org.trackify.storage.Storage;
import org.trackify.storage.StorageException;
import org.trackify.storage.query.Columns;
import org.trackify.storage.query.Condition;
import org.trackify.storage.query.Request;

import jakarta.inject.Inject;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Date;
import java.util.stream.Stream;
import javax.xml.stream.XMLOutputFactory;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamWriter;

public class KmlExportProvider {

    private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter
            .ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.systemDefault());

    private final Storage storage;

    @Inject
    public KmlExportProvider(Storage storage) {
        this.storage = storage;
    }

    public void generate(
            OutputStream outputStream, long deviceId, long geofenceId, Date from, Date to)
            throws StorageException, XMLStreamException {

        var device = storage.getObject(Device.class, new Request(
                new Columns.All(), new Condition.Equals("id", deviceId)));

        Geofence geofence = geofenceId == 0 ? null : storage.getObject(Geofence.class, new Request(
                new Columns.All(), new Condition.Equals("id", geofenceId)));

        XMLStreamWriter writer = XMLOutputFactory.newFactory()
                .createXMLStreamWriter(outputStream, StandardCharsets.UTF_8.name());

        writer.writeStartDocument(StandardCharsets.UTF_8.name(), "1.0");
        writer.writeStartElement("kml");
        writer.writeDefaultNamespace("http://www.opengis.net/kml/2.2");
        writer.writeStartElement("Document");
        writer.writeStartElement("name");
        writer.writeCharacters(device.getName());
        writer.writeEndElement();
        writer.writeStartElement("Placemark");
        writer.writeStartElement("name");
        writer.writeCharacters(DATE_FORMAT.format(from.toInstant()) + " - " + DATE_FORMAT.format(to.toInstant()));
        writer.writeEndElement();
        writer.writeStartElement("LineString");
        writer.writeStartElement("extrude");
        writer.writeCharacters("1");
        writer.writeEndElement();
        writer.writeStartElement("tessellate");
        writer.writeCharacters("1");
        writer.writeEndElement();
        writer.writeStartElement("altitudeMode");
        writer.writeCharacters("absolute");
        writer.writeEndElement();
        writer.writeStartElement("coordinates");
        try (Stream<Position> positions = PositionUtil.getPositionsStream(storage, deviceId, from, to)
                .filter(position -> geofence == null || geofence.containsPosition(position))) {
            String separator = "";
            for (var iterator = positions.iterator(); iterator.hasNext();) {
                Position position = iterator.next();
                writer.writeCharacters(separator + String.format(
                        "%f,%f,%f", position.getLongitude(), position.getLatitude(), position.getAltitude()));
                separator = " ";
            }
        }
        writer.writeEndElement();
        writer.writeEndElement();
        writer.writeEndElement();
        writer.writeEndElement();
        writer.writeEndElement();
        writer.writeEndDocument();
        writer.flush();
        writer.close();
    }

}
