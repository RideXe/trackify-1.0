package org.trackify.protocol;

import org.junit.jupiter.api.Test;
import org.trackify.ProtocolTest;
import org.trackify.model.Command;

public class TopinProtocolEncoderTest extends ProtocolTest {

    @Test
    public void testEncode() throws Exception {

        var encoder = inject(new TopinProtocolEncoder(null));

        Command command = new Command();
        command.setDeviceId(1);
        command.setType(Command.TYPE_SOS_NUMBER);
        command.set(Command.KEY_INDEX, 1);
        command.set(Command.KEY_PHONE, "13533333333");

        verifyCommand(encoder, command, binary("78780C4131333533333333333333330D0A"));

    }

}
