/*
 * Copyright 2019 - 2022 Anton Tananaev (anton@trackify.org)
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
package org.trackify.protocol;

import io.netty.channel.Channel;
import org.trackify.BaseProtocolDecoder;
import org.trackify.session.DeviceSession;
import org.trackify.Protocol;
import org.trackify.helper.DateUtil;
import org.trackify.helper.UnitsConverter;
import org.trackify.model.CellTower;
import org.trackify.model.Network;
import org.trackify.model.Position;
import org.trackify.model.WifiAccessPoint;

import java.net.SocketAddress;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

public class S168ProtocolDecoder extends BaseProtocolDecoder {

    private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter
            .ofPattern("yyMMddHHmmss").withZone(ZoneOffset.UTC);

    public S168ProtocolDecoder(Protocol protocol) {
        super(protocol);
    }

    @Override
    protected Object decode(
            Channel channel, SocketAddress remoteAddress, Object msg) throws Exception {

        String sentence = (String) msg;
        String[] values = sentence.split("#");

        DeviceSession deviceSession = getDeviceSession(channel, remoteAddress, values[1]);
        if (deviceSession == null) {
            return null;
        }

        Position position = new Position(getProtocolName());
        position.setDeviceId(deviceSession.getDeviceId());

        Network network = new Network();

        String content = values[4];
        String[] fragments = content.split(";");
        for (String fragment : fragments) {
            if (fragment.isEmpty()) {
                continue;
            }

            int dataIndex = fragment.indexOf(':');
            String type = fragment.substring(0, dataIndex);
            values = fragment.substring(dataIndex + 1).split(",");
            int index = 0;

            switch (type) {
                case "GDATA":
                    position.setValid(values[index++].equals("A"));
                    position.set(Position.KEY_SATELLITES, Integer.parseInt(values[index++]));
                    position.setTime(DateUtil.parse(DATE_FORMAT, values[index++]));
                    position.setLatitude(Double.parseDouble(values[index++]));
                    position.setLongitude(Double.parseDouble(values[index++]));
                    position.setSpeed(UnitsConverter.knotsFromKph(Double.parseDouble(values[index++])));
                    position.setCourse(Integer.parseInt(values[index++]));
                    position.setAltitude(Integer.parseInt(values[index++]));
                    break;
                case "CELL":
                    int cellCount = Integer.parseInt(values[index++]);
                    int mcc = Integer.parseInt(values[index++], 16);
                    int mnc = Integer.parseInt(values[index++], 16);
                    for (int i = 0; i < cellCount; i++) {
                        network.addCellTower(CellTower.from(
                                mcc, mnc, Integer.parseInt(values[index++], 16), Integer.parseInt(values[index++], 16),
                                Integer.parseInt(values[index++], 16)));
                    }
                    break;
                case "WIFI":
                    int wifiCount = Integer.parseInt(values[index++]);
                    for (int i = 0; i < wifiCount; i++) {
                        network.addWifiAccessPoint(WifiAccessPoint.from(
                                values[index++].replace('-', ':'), Integer.parseInt(values[index++])));
                    }
                    break;
                case "STATUS":
                    position.set(Position.KEY_BATTERY_LEVEL, Integer.parseInt(values[index++]));
                    position.set(Position.KEY_RSSI, Integer.parseInt(values[index++]));
                    break;
                default:
                    break;
            }
        }

        if (network.getCellTowers() != null || network.getWifiAccessPoints() != null) {
            position.setNetwork(network);
        }
        if (!position.hasAttribute(Position.KEY_SATELLITES)) {
            getLastLocation(position, null);
        }

        if (position.getNetwork() != null || !position.getAttributes().isEmpty()) {
            return position;
        } else {
            return null;
        }
    }

}
